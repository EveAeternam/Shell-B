"""Saved state for the apps Shell:B builds: HTML chat artifacts and Studio/Code web apps.

They run in sandboxed iframes with an opaque origin, where `localStorage` throws, so a tracker or a to-do app would
forget everything on reload. Every such page instead loads `/api/appstate/boot.js?s=<scope>` as a blocking script
first. It defines `localStorage` (and an in-memory `sessionStorage`) preloaded with the saved data, plus an async
`window.shellb.storage`, and sends writes back here. Scopes:

- `art:<conv_id>:<artifact_id>`: one chat artifact, shared by all its versions
- `proj:<project_id>`: one Studio/Code project, shared by all its pages

`ro=1` (Library thumbnails) loads the data but never writes. No scope gives the same API without saving anything
(rich-link previews).
"""
import json
import re
import time
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

import db

router = APIRouter(prefix="/api/appstate")

SCOPE_RE = re.compile(r"^(art:[A-Za-z0-9_-]{1,64}:[a-z0-9-]{1,64}|proj:[A-Za-z0-9_-]{1,64})$")
MAX_BYTES = 10 * 1024 * 1024  # per scope
CORS = {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}


def _scope(s: str | None) -> str:
    if not s or not SCOPE_RE.match(s):
        raise HTTPException(400, "Bad scope")
    return s


def load(scope: str) -> dict:
    with db.conn() as c:
        return {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM app_state WHERE scope=?", (scope,))}


BOOT = r"""(function(){
var S=%(scope)s,RO=%(ro)s,data=%(data)s,url=%(url)s,pend={},del={},clr=false,timer=0;
function flush(beacon){
  timer=0;if(!S||RO)return;var ks=Object.keys(pend),ds=Object.keys(del);if(!ks.length&&!ds.length&&!clr)return;
  var body=JSON.stringify({set:pend,del:ds,clear:clr});pend={};del={};clr=false;
  try{if(beacon&&navigator.sendBeacon&&navigator.sendBeacon(url,body))return;}catch(e){}
  try{fetch(url,{method:'POST',body:body,keepalive:body.length<60000,headers:{'Content-Type':'text/plain'}}).catch(function(){});}catch(e){}
}
function later(){if(!timer)timer=setTimeout(flush,300);}
function mk(store,persist){
  var api={
    getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null;},
    setItem:function(k,v){k=String(k);v=String(v);store[k]=v;if(persist){pend[k]=v;delete del[k];later();}},
    removeItem:function(k){k=String(k);delete store[k];if(persist){delete pend[k];del[k]=1;later();}},
    clear:function(){for(var k in store)delete store[k];if(persist){pend={};del={};clr=true;later();}},
    key:function(i){var ks=Object.keys(store);return i>=0&&i<ks.length?ks[i]:null;}
  };
  Object.defineProperty(api,'length',{get:function(){return Object.keys(store).length;},configurable:true});
  /* also allow localStorage.foo = 'x' and localStorage.foo reads, like the real Storage */
  return typeof Proxy==='undefined'?api:new Proxy(api,{
    get:function(t,k){return k in t||typeof k!=='string'?t[k]:t.getItem(k);},
    set:function(t,k,v){if(k in t)t[k]=v;else t.setItem(k,v);return true;},
    deleteProperty:function(t,k){t.removeItem(k);return true;},
    has:function(t,k){return k in t||Object.prototype.hasOwnProperty.call(store,k);},
    ownKeys:function(){return Object.keys(store);},
    getOwnPropertyDescriptor:function(t,k){return Object.prototype.hasOwnProperty.call(store,k)?{value:store[k],enumerable:true,configurable:true,writable:true}:undefined;}
  });
}
var local=mk(data,true),session=mk({},false);
function put(n,v){try{Object.defineProperty(window,n,{value:v,configurable:true,enumerable:true,writable:false});}catch(e){}}
put('localStorage',local);put('sessionStorage',session);
var sb=window.shellb=window.shellb||{};
sb.persistent=!!S&&!RO;
sb.storage={
  get:function(k){var v=local.getItem(k);if(v===null)return Promise.resolve(null);try{return Promise.resolve(JSON.parse(v));}catch(e){return Promise.resolve(v);}},
  set:function(k,v){local.setItem(k,JSON.stringify(v));return Promise.resolve();},
  delete:function(k){local.removeItem(k);return Promise.resolve();},
  keys:function(){return Promise.resolve(Object.keys(data));},
  clear:function(){local.clear();return Promise.resolve();},
  flush:function(){flush(false);return Promise.resolve();}
};
addEventListener('pagehide',function(){flush(true);});
addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush(true);});
})();"""


@router.get("/boot.js")
def boot(request: Request):
    q = request.query_params
    scope = _scope(q["s"]) if q.get("s") else None
    data = load(scope) if scope else {}
    # under a frame key (server/auth.py) the page has no cookie, so writes go back through the same prefix
    url = f"{request.scope.get('shellb_prefix', '/api')}/appstate?s={quote(scope)}" if scope else ""
    js = BOOT % {"scope": json.dumps(scope), "ro": "true" if q.get("ro") else "false",
                 "data": json.dumps(data).replace("</", "<\\/"), "url": json.dumps(url)}
    return Response(js, media_type="text/javascript; charset=utf-8", headers=CORS)


@router.get("")
def get_state(s: str):
    return Response(json.dumps(load(_scope(s))), media_type="application/json", headers=CORS)


@router.post("")
async def write_state(s: str, request: Request):
    """Body (sent as text/plain so the sandboxed page needs no CORS preflight): {set:{k:v}, del:[k], clear:bool}."""
    scope = _scope(s)
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        raise HTTPException(400, "Bad JSON")
    sets = {str(k): str(v) for k, v in (body.get("set") or {}).items()}
    dels = [str(k) for k in body.get("del") or []]
    now = time.time()
    with db.conn() as c:
        if body.get("clear"):
            c.execute("DELETE FROM app_state WHERE scope=?", (scope,))
        if dels:
            c.executemany("DELETE FROM app_state WHERE scope=? AND key=?", [(scope, k) for k in dels])
        if sets:
            c.executemany("INSERT OR REPLACE INTO app_state VALUES(?,?,?,?)", [(scope, k, v, now) for k, v in sets.items()])
        size = c.execute("SELECT COALESCE(SUM(LENGTH(key)+LENGTH(value)),0) n FROM app_state WHERE scope=?",
                         (scope,)).fetchone()["n"]
        if size > MAX_BYTES:
            c.rollback()
            raise HTTPException(413, f"App state is limited to {MAX_BYTES // 1048576} MB")
    return Response('{"ok":true}', media_type="application/json", headers=CORS)


@router.delete("")
def clear_state(s: str):
    with db.conn() as c:
        c.execute("DELETE FROM app_state WHERE scope=?", (_scope(s),))
    return {"ok": True}

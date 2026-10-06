import type { AppId } from '../components/apps';

export interface KioskWindow {
  id: string;
  appId: AppId;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  params?: {
    convId?: string;
    artifactId?: string;
    version?: number;
    projectId?: string;
    boardId?: string;
    planId?: string;
    subRoute?: string;
  };
}

export interface DesktopWidgetConfig {
  id: string;
  title: string;
  type: 'telemetry' | 'clock' | 'radio' | 'activity' | 'weather';
  x: number;
  y: number;
  width: number;
  height: number;
}

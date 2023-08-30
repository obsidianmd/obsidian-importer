import { NodePickedFile } from 'filesystem';

export interface RoamImportOptions {
  saveAttachments:Boolean,
	jsonSources: NodePickedFile[];
	outputDir: string,
	downloadAttachments:Boolean
}

export interface RoamPage {
    title: string
    children?: RoamBlock[]
    "create-time"?: number
    "create-email"?: string
    "edit-time"?: number
    "edit-email"?: string
    uid: string
  }
  
export interface RoamBlock {
  string: string
  uid?: string
  children?: RoamBlock[]
  "create-time"?: number
  "create-email"?: string
  "edit-time"?: number
  "edit-email"?: string
  heading?: 0 | 1 | 2 | 3
  "text-align"?: "left" | "center" | "right" | "justify"
  refs?: Ref[]
  ":block/refs"?: DRef[]
}

interface BlockInfo {
  pageName: string;
  lineNumber: number;
  blockString: string;
}

export interface Ref {
  uid: string
}

export interface DRef {
  ":block/uid": string
}

export interface  JsonObject {
  string?: string;
  heading?: number;
  uid?: string;
  title?: string;
  children?: JsonObject[];
}

  
  
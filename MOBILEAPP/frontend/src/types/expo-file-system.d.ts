declare module 'expo-file-system' {
  export interface FileInfo {
    uri: string;
    exists: boolean;
    isDirectory: boolean;
    size?: number;
    modificationTime?: number;
  }

  export interface FileSystemUploadOptions {
    url: string;
    fileUri: string;
    httpMethod?: 'POST' | 'PUT' | 'PATCH';
    headers?: Record<string, string>;
    uploadType?: FileSystemUploadType;
    fieldName?: string;
    mimeType?: string;
    parameters?: Record<string, string>;
  }

  export interface FileSystemUploadResult {
    status: number;
    body?: string;
    headers?: Record<string, string>;
  }

  export type FileSystemUploadType = 
    | 'multipart/form-data'
    | 'application/octet-stream';

  export type FileSystemEncodingType = 
    | 'utf8'
    | 'base64';

  export const EncodingType: {
    UTF8: 'utf8';
    Base64: 'base64';
  };

  export type FileSystemDirectoryPath = string;
  export type FileSystemDocumentPath = string;

  export const documentDirectory: FileSystemDirectoryPath;
  export const cacheDirectory: FileSystemDirectoryPath;
  export const bundleDirectory: FileSystemDirectoryPath;
  export const externalDirectory: FileSystemDirectoryPath | null;
  export const externalRootDirectory: FileSystemDirectoryPath | null;

  export function getInfoAsync(fileUri: string, options?: { md5?: boolean }): Promise<FileInfo>;
  export function readAsStringAsync(fileUri: string, options?: { encoding?: FileSystemEncodingType }): Promise<string>;
  export function writeAsStringAsync(fileUri: string, contents: string, options?: { encoding?: FileSystemEncodingType }): Promise<void>;
  export function deleteAsync(fileUri: string, options?: { idempotent?: boolean }): Promise<void>;
  export function moveAsync(options: { from: string; to: string }): Promise<void>;
  export function copyAsync(options: { from: string; to: string }): Promise<void>;
  export function makeDirectoryAsync(fileUri: string, options?: { intermediates?: boolean }): Promise<void>;
  export function readDirectoryAsync(fileUri: string): Promise<string[]>;
  export function uploadAsync(url: string, fileUri: string, options?: FileSystemUploadOptions): Promise<FileSystemUploadResult>;
  export function createDownloadResumable(sourceUri: string, fileUri: string, options?: FileSystemUploadOptions): FileSystemDownloadResumable;
  
  export interface FileSystemDownloadResumable {
    downloadAsync(): Promise<FileSystemDownloadResult>;
    pauseAsync(): Promise<void>;
    resumeAsync(): Promise<void>;
  }

  export interface FileSystemDownloadResult {
    uri: string;
    status: number;
    headers?: Record<string, string>;
  }

  export function getContentUriAsync(fileUri: string): Promise<string>;
  export function getFreeDiskStorageAsync(): Promise<number>;
  export function getTotalDiskCapacityAsync(): Promise<number>;
}

import * as vscode from "vscode";

export function getRelativeFilePath(filepath: string): string {
  const workspaceFolder = vscode.workspace.workspaceFolders;

  if (!workspaceFolder || workspaceFolder.length === 0) {
    // can be a single file, or no workspace open, return the absolute path. eg. /Users/username/project/file.ts
    return filepath.split("/").pop() || filepath;
  }

  for (const folder of workspaceFolder) {
    const folderPath = folder.uri.fsPath;
    if (filepath.startsWith(folderPath)) {
      // return the relative path of the file within the workspace folder. eg. src/file.ts
      const relativePath = filepath.substring(folderPath.length + 1);
      return relativePath;
    }
  }

  return filepath;
}

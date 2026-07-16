/**
 * DesignWan Electron Preload 脚本（Context Isolation + Sandbox 模式）。
 *
 * 严格约束（HANDOFF_PROTOCOL.md §1 / STACK_AND_ARCHITECTURE.md §3.2）：
 * - 只通过 contextBridge.exposeInMainWorld 暴露 @designwan/contracts/ipc 定义的 PreloadBridge
 * - 每个业务动作调用具体的 ipcRenderer.invoke('<specific-channel>')
 * - 禁止暴露 ipcRenderer、ipcRenderer.on、文件路径、数据库句柄、shell
 * - 禁止通用 invoke(channel, payload) 形态
 *
 * 真实业务动作（capture.submit / asset.query / project.command 等）由后续卡在此扩展。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { PreloadBridge } from '@designwan/contracts/ipc';

// 窄 IPC channel 常量；必须与 Main 一致
const IPC_CHANNEL_NEGOTIATE = 'designwan:negotiate';
const IPC_CHANNEL_PING = 'designwan:ping';

const bridge: PreloadBridge = {
  // 协议版本协商，Renderer 启动时调用一次
  negotiate: () => ipcRenderer.invoke(IPC_CHANNEL_NEGOTIATE),
  // 健康检查
  ping: () => ipcRenderer.invoke(IPC_CHANNEL_PING),
};

// 只暴露具体函数，不暴露 ipcRenderer 本身
contextBridge.exposeInMainWorld('designwan', bridge);

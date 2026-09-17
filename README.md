# HD2CB

《绝地潜兵 2》鼠标长按充能提示工具，基于 [nine-sec/HD2-ChargeBar](https://github.com/nine-sec/HD2-ChargeBar) 改进。最新发布版本：**1.1.0**（main 已增加下述武器切换功能，尚未发布新运行包），适用于 Windows x64。

本项目保留原作者版权及 ISC 许可证，新增托盘管理、单实例运行、前台窗口识别和可配置热键。前台判定参考 [GRW-CNChat](https://github.com/GameXueRen/GRW-CNChat) 的思路，使用独立编写的 Windows API 检测助手，未复制其 AutoHotkey 代码。

## 下载与运行

从 [Releases](https://github.com/JunziSama/HD2CB/releases) 下载 `HD2CB-v1.1.0-win32-x64.zip`，完整解压后运行 `ChargeBar-win32-x64/ChargeBar.exe`。不要单独移动 EXE。

GitHub 的 “Source code” 压缩包仅含源码，不包含 Electron、依赖或已编译助手，不能直接双击运行。

## 功能

- 启动通知与常驻托盘；重复启动会提示已有实例。
- 隐藏、按住右键显示、游戏内常显三种模式；首次默认按住右键显示。
- 仅 HD2 位于前台时显示；切出后隐藏并清空充能状态。
- 默认 F1 切换模式、F2 退出、F3 切换武器，仅游戏前台生效；可分别开关、修改快捷键。
- 自动记住武器选择、显示模式和热键设置。关闭设置窗口后继续驻留托盘。
- 支持 PLAS-45 纪元与 RS-422 磁轨炮（不安全模式），分别显示颜色和刻度。
- 两把武器到顶后保留红色 0.5 秒，再隐藏等待新的左键按下；切换时在条旁提示武器名 2 秒。

本工具显示鼠标长按时间，不读取游戏实际武器充能状态。建议使用窗口化或无边框游戏模式。

详见 [使用及开发说明](ChargeBar-win32-x64/resources/app/README.md) 和 [验证记录](ChargeBar-win32-x64/resources/app/VALIDATION.md)。

## 源码与测试

源码保留在 `ChargeBar-win32-x64/resources/app`：`src` 为 Electron 应用，`native` 为检测助手及构建脚本，`tests` 为自动化测试。运行依赖与二进制通过 Releases 提供，不纳入 Git。

在 Windows 上安装 Node.js 后，可执行不依赖 Electron 安装的状态及助手测试：

```powershell
cd ChargeBar-win32-x64/resources/app
powershell -NoProfile -ExecutionPolicy Bypass -File native/build.ps1
npm test
```

需要 .NET Framework 4 的 C# 编译器。实际启动检查 `npm run test:smoke` 需要完整运行包目录；测试使用独立配置，不修改用户设置。源码开发与重新打包需另外准备兼容 Electron 4.2.12 的开发依赖及 iohook 构建环境，详情见应用说明。

## 验证范围

已验证状态与配置逻辑、检测助手、单实例启动、托盘创建、设置保存与恢复、异常助手恢复、退出清理。

**真实 HD2 内的焦点切换、200 毫秒隐藏目标和覆盖显示效果尚未实测。** 独占全屏及游戏实际输入仍需在游戏环境中确认。

## 许可证

应用代码采用 [ISC License](LICENSE)，保留 `Copyright (c) 2026 Stegosaurus`。运行包附带的 Electron、Chromium 和其他依赖适用各自许可证。

工具不修改游戏数据、不注入游戏、不模拟输入。反作弊兼容性没有保证；使用前请确认游戏对第三方工具的要求。

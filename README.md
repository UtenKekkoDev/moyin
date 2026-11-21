# 墨隐

Windows x64 上运行的本地文档脱敏工具。导入 Word 正文或粘贴材料，输入准备交给外部 AI 的写作提示词，再用自己的话说明要隐去什么。工具给出候选，员工逐处核对，复制对外稿，并可在当前会话按稿号回填。PDF 另有逐页框选和导出功能，扫描页需要人工框选。

## 安装

1. 在本仓库的 Releases 下载 `moyin-windows-x64-v0.1.0-beta.2.zip` 和 `SHA256SUMS.txt`。用 PowerShell 的 `Get-FileHash` 核对压缩包后解压到可写目录。
2. 下载固定版本的 [Aztec-Coder-4B.Q4_K_M.gguf](https://huggingface.co/mradermacher/Aztec-Coder-4B-GGUF/resolve/488fa00b1e01fc00965b4467e6e592a78316ebb4/Aztec-Coder-4B.Q4_K_M.gguf)，放入解压目录的 `models` 文件夹。也可以从已有的完整离线版复制同名文件。
3. 在解压目录执行以下命令。输出应为 `d3a654bc04d48fbba8172a24e76fc91ae67f28f63a250988a243b433a218673f`（忽略大小写）。

   ```powershell
   Get-FileHash .\models\Aztec-Coder-4B.Q4_K_M.gguf -Algorithm SHA256
   ```

4. 双击 **启动墨隐.cmd**，在近期版本的 Edge 或 Chrome 使用本机页面。模型就位后可离线运行。源码检出目录可从同版本 Release 复制 `runtime` 和已校验的 `models`，使用同一启动入口。

## 快速验收

导入 `examples/模拟项目计划.docx`，将 `examples/提示词.txt` 填入写作提示词，开始识别。逐处检查正文与提示词，补标漏项，确认全称和简称的代号。复制到本机记事本，检查对外稿；保留稿号并调整句序后粘回工作台，逐项检查回填。页面刷新后，需重新建立代号映射。

自动初稿仍需人工确认。Word 识别范围为受支持的正文和表格，页眉、页脚、批注、嵌入文件及图片应另行检查。复制后文本进入系统剪贴板。

[详细使用说明](./使用说明.md) · [版本与已知问题](./RELEASE.md) · [第三方许可](./licenses/)

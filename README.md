# 墨隐

墨隐是一个 Windows x64 文档脱敏工作台。把内部 Word 和准备交给外部 AI 的写作提示词放在一起核对，确认每处替换后复制对外稿。需要恢复原名或数值时，把带稿号的返回文本粘回同一页面。

## 快速启动

1. 登录有权限的 GitHub 账号，在 [v0.1.0 正式版](https://github.com/UtenKekkoDev/moyin/releases/tag/v0.1.0) 下载 Windows x64 ZIP 和 `SHA256SUMS.txt`。用 `Get-FileHash .\moyin-windows-x64-v0.1.0.zip` 与校验单核对后，解压到可写目录。ZIP 已附 Node 和 llama.cpp 运行时；源码检出可从 ZIP 复制 `runtime\`。
2. 默认只需下载 [Aztec-Coder-4B.Q4_K_M.gguf](https://huggingface.co/mradermacher/Aztec-Coder-4B-GGUF/resolve/488fa00b1e01fc00965b4467e6e592a78316ebb4/Aztec-Coder-4B.Q4_K_M.gguf)，按原文件名放在 `models\` 中。在解压目录运行 `Get-FileHash .\models\*.gguf -Algorithm SHA256`，与下表核对。
3. 双击 **启动墨隐.cmd**，在 Edge 或 Chrome 中打开工作台。首次体验可导入 `examples\模拟项目计划.docx`，将 `examples\提示词.txt` 粘入写作提示词。

| 本机权重（两种模式独立下载） | SHA-256 |
|---|---|
| Aztec-Coder-4B.Q4_K_M.gguf | `d3a654bc04d48fbba8172a24e76fc91ae67f28f63a250988a243b433a218673f` |
| [Qwen3.6-27B-IQ4_XS.gguf](https://huggingface.co/unsloth/Qwen3.6-27B-GGUF/resolve/main/Qwen3.6-27B-IQ4_XS.gguf) | `8a3365759dc1b33b52c4e7d91d5a67d5ee1418e8408aa54196f04a98da53e5dc` |

## 从 Word 到返回汇报

1. **导入材料。** 工作台读取 .docx 正文和表格，也支持 TXT、Markdown 或粘贴文本。把写作提示词填入单独输入框，两区均可核对。页眉、页脚、批注、图片和嵌入附件需另行检查。PDF 可用独立的「文件涂黑」页面逐页框选导出。
2. **确认本次规则。** 选择「隐藏对客报价」或「隐藏对客报价及延期」，按需限定正文、提示词、收报价方或实际延期，检查确认卡中的遮盖项、保留项和条件。开发版支持在高精度模式直接填写本地脱敏要求。例如「隐藏全部价格」覆盖内部测算价、采购价和对客报价。标准规则会展示范围和条件，模板外要求会展示原话，点击确认后由 27B 识别并逐处核对。快速模式遇到未匹配的要求时仍可明确选择回退识别。
3. **逐处看总览。** 「已识别金额与时长」分为待核高亮、建议遮盖、建议保留。待核项在初稿中暂留原文。保留区默认展开，可查看分区、行号和上下文；同额的两个位置可分别改选。漏项可选中原文手动补标。
4. **复制与回填。** 核对完成后做复制前复查，再复制带稿号的对外稿。将外部编辑返回的文本和原稿号粘回工作台，按代号逐处选择并核对还原值。代号表保存在当前页面会话中，回填完成前请保留页面。

## 选哪种模式

| | 快速模式 · 本机 4B（默认） | 高精度模式 · 27B（可选） |
|---|---|---|
| 适用任务 | 常规实体、数值、自由指令及词表。金额用途默认用双提示交叉核对 | 报价、延期等标准规则按业务类别判别并提供依据；开发版还支持按员工自定义原话提取 |
| 单稿识别参考 | 5 份 Word 中位约 5.3 秒（原指令路径） | 同组 Word 中位约 22.2 秒（模板路径）。本机加载权重另有实测约 10–16 秒 |
| 本机硬件参考 | RTX 5080 上测得整卡峰值约 6.0 GiB，服务进程工作集约 4.0 GiB | 本机已在 16 GB 显存 RTX 5080 上验证，整卡峰值约 13.9 GiB，进程工作集约 25.6 GiB。也可由内网主机承担推理 |

时间取自浏览器点击识别到收到初稿，包含当次启动，加载耗时无需重复相加。内存数字来自独立采样，非硬件最低门槛；请为系统、浏览器及其他应用预留内存。本机按需互斥加载，旧 llama-server 退出后才启动另一个权重。27B 仅在规则限定收报价方时比较对象，明确为其他对象则保留，证据不足则高亮待核。业务依据仅用于核对。

## 可选配置

在同一 PowerShell 窗口先设置所需变量，再运行 `& '.\启动墨隐.cmd'`。修改后重启生效。

| 变量 | 用途与 PowerShell 示例 |
|---|---|
| `MOYIN_27B_MODEL` | 自定义本机文件，例如 `$env:MOYIN_27B_MODEL='D:\models\Qwen3.6-27B-IQ4_XS.gguf'`。默认查找程序目录下同名的 `models\` 文件 |
| `MOYIN_27B_URL` | 已有内网主机加载上述 27B 权重后，设置服务根地址，例如 `$env:MOYIN_27B_URL='http://192.168.1.20:8080'`。服务需支持 llama-server 的 `/apply-template` 和 `/completion`。该选项优先于本机权重 |
| `MOYIN_27B_KEY` | 内网服务启用 API Key 时，在启动进程环境中设置对应凭据 |
| `MOYIN_DUAL_MONEY` | 4B 默认使用双提示。设置 `$env:MOYIN_DUAL_MONEY='0'` 切换为单提示；用 `Remove-Item Env:MOYIN_DUAL_MONEY` 恢复默认 |

**数据边界。** 本机模式通过回环接口处理正文和提示词，权重就位后可断网使用。内网模式会向配置的 URL 发送含原文的推理请求，请只填写可信的公司内网服务地址。配置指向哪里，数据就发往哪里；客户端不会把任意 URL 强制限制为内网。正常本机或内网配置下，墨隐不会自动上传材料到公网 AI。复制会写入系统剪贴板，后续粘贴到哪里由使用者决定。

## 运行全部 11 项专项测试

在仓库根目录准备好 `runtime\` 和已校验的 4B 权重，用 PowerShell 执行。部分专项会启动真实的本机 4B 模型。

```powershell
$tests = Get-ChildItem .\tests\*.cjs | Where-Object Name -ne 'evaluate.cjs'
foreach ($test in $tests) {
    & .\runtime\node.exe $test.FullName
    if ($LASTEXITCODE -ne 0) { throw "专项失败 $($test.Name)" }
    Write-Host "通过 $($test.Name)"
}
```

`evaluate.cjs` 是需要另传语料参数的评测入口。封版验收中，高精度模板 U01–U05 自动初稿 5/5 正确，人工纠正 0 处；快速模式 23/23 份日常 Word 经人工核对后完成复制回填；11/11 项专项测试通过。[使用说明](./使用说明.md) · [第三方许可](./licenses/)

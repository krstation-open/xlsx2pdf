# 贡献指南

感谢你对 xlsx2pdf（社区版）的关注！欢迎 issue 与 PR。

## 贡献者许可协议（CLA）

提交 PR 即表示你同意以下条款：

1. 你授予项目维护方（恺睿（深圳）软件科技有限公司）对你所提交贡献的永久性、
   全球性、非独占、免版税的使用许可，包括以任意许可证（含商业许可证）
   再许可、重新许可与双许可的权利。
2. 你确认所提交内容为你的原创作品，或你已获得合法授权提交，且不侵犯任何第三方权利。
3. 维护方保留将社区核心与商业版本分别许可的权利；你的贡献不会改变本仓库
   Apache-2.0 的对外许可。

首次提交 PR 时请在描述中附上签署声明：

> I have read and agree to the CLA.（我已阅读并同意贡献者许可协议。）

## 提交规范

- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
  `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` 等，
  由 commitlint + husky 钩子自动校验。
- 一个 PR 只做一件事；行为变更请附测试（`test/` 目录）。

## 本地开发

```bash
# 安装依赖（跳过内置 Chrome 下载，复用本机浏览器测试）
XLSX2PDF_SKIP_BROWSER=1 npm install

npm run build      # esbuild 双产物（ESM/CJS）
npm run redline    # 红线扫描（必须零命中）
npm test           # ESM 冒烟
npm run test:cjs   # CJS 冒烟
npm run test:media # 富媒体守卫（image/barcode/qrcode + 浮层 + 尺寸归一）
npm run test:detail # 明细行守卫（#数组.字段 索引映射）
```

PDF 相关测试需要浏览器：`configure({ browserPath })` 或环境变量
`XLSX2PDF_BROWSER_PATH` 指向本机 Chrome/Chromium，或 `npx xlsx2pdf-browser install` 补装内置浏览器。

## 范围边界（重要）

- 本仓库是**社区版**：文本类报表模板 → PDF 的完整链路。
- 商业版 Pro 的专有技术（生产化保真、富媒体标记、批量与护栏、扩展点等）
  **不在本仓库范围内，亦不接受相关实现的贡献**。请勿在 issue/PR 中
  粘贴、描述或索取任何未公开的商业版实现细节。
- 公开讨论只涉及「问题现象」与「效果对比」，不涉及未公开算法的实现步骤。

## 问题反馈

- Bug / 功能建议：GitHub Issues（附最小复现模板与数据）。
- 商业版咨询 / POC：business@krstation.com。
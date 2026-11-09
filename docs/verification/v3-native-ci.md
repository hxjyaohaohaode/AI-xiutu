# V3 原生 PostgreSQL 与容器 CI 证据

[GitHub Actions 42675978995](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42675978995)实际结论为 **success**。

- 代码提交：`88d3eb5f70b4722e0d040e56090aea18fc820d8f`。
- 完整文件树：`4d31e148e02442c7b7ca63ad1ede2a7e8b5eb50f`，与本地提交前索引的 `git write-tree` 逐SHA一致。
- 工作流：`2026-11-09T18:39:45Z` 开始，`2026-11-09T18:42:49Z` 更新为完成。
- 这份文档在该运行结束后补交，只改变Markdown；代码/配置冻结指纹不变。

| job | ID | 开始 UTC | 完成 UTC | 结论 |
| --- | --- | --- | --- | --- |
| baseline | 129357345163 | 2026-11-09T18:39:49Z | 2026-11-09T18:41:28Z | success |
| containers | 129358213702 | 2026-11-09T18:41:31Z | 2026-11-09T18:42:48Z | success |

## 原生数据库

日志中的服务版本为PostgreSQL18.6，配置连接池10；严格类型检查、444项完整测试、生产构建和生产依赖审计通过。准备脚本真实取得并验证了固定模型资源。未把本地PGlite单后端结果冒充原生并发结果。

```text
2026-11-09T18:40:16.3360986Z found 0 vulnerabilities
2026-11-09T18:41:21.5355845Z ℹ tests 444
2026-11-09T18:41:21.5357703Z ℹ pass 444
2026-11-09T18:41:21.5358061Z ℹ fail 0
2026-11-09T18:41:21.5358496Z ℹ cancelled 0
2026-11-09T18:41:21.5358984Z ℹ skipped 0
2026-11-09T18:41:21.5359446Z ℹ todo 0
2026-11-09T18:41:23.2458894Z found 0 vulnerabilities
```

测试包含故意触发的不可变记录拒绝、事务错误与失败恢复，因此数据库停止时输出相应ERROR/WARNING是这些反例的日志，不是把失败测试隐藏成成功；最终测试统计和job均成功。

## 容器

实际构建后端与网页目标，启动PostgreSQL、迁移、API、AI Worker及Caddy。工作流断言迁移退出码0、服务运行/健康、DB/API/Worker没有宿主端口绑定、API与Worker共享私有素材/发送日志卷；真实访问公开配置、网页、健康和未登录私有API。

它还验证WASM CSP、3个同源模型文件的SHA、缺失模型404而不是SPA HTML，以及外部AI/短信/支付未启用。实际输出片段：

```text
2026-11-09T18:41:48.5932400Z #14 0.498 Verified face_landmarker.task (3758596 bytes)
2026-11-09T18:41:48.5933695Z #14 0.562 Verified pose_landmarker_lite.task (5777746 bytes)
2026-11-09T18:41:48.6722952Z #14 0.792 Verified selfie_multiclass_256x256.tflite (16371837 bytes)
2026-11-09T18:41:48.8334515Z #14 0.802 Local vision assets ready. They are served from the website origin; no external CDN is needed at runtime.
2026-11-09T18:42:44.9372196Z Container smoke checks passed; no SMS or model request was enabled or sent.
```

## 日志完整性与范围

以下SHA对应本次取回并按UTF-8保存的完整解码日志；本页为摘录，完整运行可从上述GitHub job查看。

- `baseline`：100372字节，SHA-256 `c49a6a6c0f993f8154594e96f113adab9236c6724c9c3c50f8cd82971974e4c0`。
- `containers`：55589字节，SHA-256 `f89beafc2c44305d3b4c4430834b067c2f281a1e6e5f628b5b9d13091dd1d57f`。

CI额外保留了两类非阻断提示：生产主入口超过500kB；固定SHA的checkout/setup-node action声明Node20，运行器实际强制Node24执行并成功。升级action固定版本属于后续维护，本次没有改配置隐藏警告。

本地HTTP容器检查不是生产HTTPS、真实移动设备、浏览器WebGL推理、短信实收、收费模型、支付、JMS代理或大陆用户网络验收；本轮没有发送这些外部请求。

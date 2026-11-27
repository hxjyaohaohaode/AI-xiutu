# 腾讯云轻量实例自动更新

GitHub Actions 在同一次 `main` 推送的 Baseline checks、Frontend system redesign review、AI interaction checks 和 Account lifecycle checks 都成功后，才为该提交构建 Linux x86_64 的 API/Worker 和 Web 镜像。两个镜像属于同一个完整 SHA，并通过该 SHA 的 `cloud-<sha>` 预发行附件提供。预发行不替换面向用户的正式发布。实例定时检查当前 `main`，复核四套检查结果，下载并校验 GitHub 给出的 SHA-256 摘要，不需要 GitHub 用户令牌、远程构建或向 GitHub 提供服务器密钥。

此流程适用于现有 `/home/ubuntu/xiutu-pilot` 安装。现场的 `compose.pilot.yaml` 中，API、Worker、迁移镜像使用 `xiutu-pilot-server:${XIUTU_IMAGE_REF:?Set XIUTU_IMAGE_REF}`，Web 镜像使用 `xiutu-pilot-web:${XIUTU_IMAGE_REF:?Set XIUTU_IMAGE_REF}`。手动运行 Compose 时，需从 `RELEASE` 读取并传入当前镜像标签。应用数据、发布记录、Caddy、HTTPS 和短信配置继续使用原 Compose 项目及卷。分享入口的随机值留在实例 `state/friend-link` 私有文件；不得写入源码、发布记录或公共日志。

首次安装，先检查 `RELEASE` 记录的当前全长 SHA；旧部署镜像仅有七位标签时，把该全长 SHA 另记入 `state/legacy-sha`。部署程序和单元文件由系统管理员安装：

```sh
sudo install -m 0755 infra/tencent/follow-main.sh /usr/local/sbin/xiutu-follow-main
sudo install -m 0644 infra/tencent/fetch-release.py /usr/local/sbin/fetch-release.py
sudo install -m 0644 infra/tencent/xiutu-follow-main.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xiutu-follow-main.timer
sudo systemctl start xiutu-follow-main.service
sudo journalctl -u xiutu-follow-main.service -n 30 --no-pager
```

更新前校验基础 Compose 文件和已应用的数据库迁移列表；普通更新保留数据库、私有素材和派发日志。换版本后检查三进程是否使用同一批镜像、HTTPS、应用及数据库健康、短信配置和未登录的访问边界。公开配置报告的注册模式必须与数据库当前的开放或邀请模式一致。检查失败时恢复上一批镜像并暂停该 SHA。修复后推送新的 `main`，或在确认问题已消除后移除 `state/blocked-sha` 重试。基础 Compose 或数据库迁移变更需要单独的备份、协调更新与恢复验收，定时任务不会自动回滚数据库或清理数据卷。

下载可在后续定时检查中续传。实例只保留当前候选的一份未完成附件；完整文件通过大小与 SHA-256 检查后才会交给 Docker。下载期间保留当前服务。

迁移 28 新增赞赏设置表、个人创作项目标记、助手偏好和原图永久删除时间。现有安装更新时，先取得该 SHA 的已校验候选镜像，保留现行镜像和发布记录，并在独立数据库上恢复最新备份验证。实际切换由服务器操作者在同一维护窗口完成：暂停自动更新计时器并确认没有发布在运行，暂停写入，备份数据库与私有存储；用候选服务器镜像的 `migrate` 服务应用迁移，然后启动同一 SHA 的 API、Worker 和 Web。保留现有卷和 Compose 项目，不在运行中的旧应用上单独应用新迁移。检查版本、`/health`、注册模式及登录后的作品和助手流程后恢复计时器。旧程序会拒绝不匹配的数据库版本；切换失败需要按已验证的备份恢复流程与旧镜像一起回滚。

### 发布附件的分段下载与断点恢复

`fetch-release.py` 可独立运行，依赖 Linux 和 Python 3.8 或以上的标准库。部署器从同一份 GitHub release 资产元数据取出 `browser_download_url`、`size` 和 `digest`，并把校验完成的文件路径交给下一步。

```sh
python3 /usr/local/sbin/fetch-release.py \
  --url "$asset_url" --size "$asset_size" --sha256 "$digest" --output "$bundle"
```

默认使用 10 路连接，每个区间 4 MiB，`--workers 1` 至 `--workers 12` 可调整并发。入口限定本仓库的 `cloud-<40位提交>` 发布附件，重定向限定 GitHub 的 HTTPS 资产域名。实例不需要 GitHub 令牌。端到端速率还受实例到 GitHub 的出口、CDN 和共享带宽影响。

暂存的稀疏文件与区间进度在 `<输出路径>.resume/`。每个区间按 512 KiB 提交检查点，并在中断时记录已收到的有效前缀。先同步数据，再原子发布进度。用相同参数重跑时，继续请求尚缺的字节。只支持 HTTP 200 的服务会自动使用单连接完整传输。网络中断后，这类服务需要从头传输。稳定的 `<输出路径>.lock` 为同一输出路径串行化下载器。

下载器校验分段 206 的区间、总长度、实际接收字节以及最终完整文件的 SHA-256。成功才原子替换输出并返回 0。已存在的同摘要文件可直接复用。失败保留之前的输出，非零退出。完整摘要不匹配时会丢弃损坏的临时数据，允许下次干净重试。下载器只操作附件与本地进度，不启动或替换容器。

使用 `python3 -B infra/tencent/test-fetch-release.py` 在本机 HTTP 服务下复验并发、精确断点、200 回退、错误响应、损坏文件恢复与官方来源限制。

### 云镜像、原生图像与供应商能力

云发布为同一个 API、Worker 和迁移镜像标签选用 `server-media` 构建目标。它继承 `server` 的中英文 OCR，并打包 RAW、OpenEXR、Radiance、Ultra HDR JPEG 和 HEIC PQ/HLG 的原生依赖。Web 继续使用 `web`。只构建 `server` 的旧附件包含 OCR，缺少上述原生组件；单独启用配置无法补齐。运行 `docker image inspect --format '{{index .Config.Labels "io.ai-xiutu.build-target"}}' "xiutu-pilot-server:$(sed -n 's/^RELEASE_SHA=//p' RELEASE)"` 可核实本机候选的构建目标。旧镜像没有这项标签。

发布前在候选镜像内枚举中英文 OCR 数据，探测 rawpy、OpenImageIO、Ultra HDR、PQ 与 HLG 解码器，并通过应用的隔离导入入口处理仓库中的 10 位 PQ HEIC 样本。检查包括原图字节、32 × 24 尺寸、解码位深及实际生成的 32 位浮点母版文件。每次发布在 Actions 摘要分别记录两个镜像的本地镜像字节数和最终压缩附件的字节数。Docker 层可共享，磁盘预留以主机当前卷空间及回退镜像为准。固定附件名称和 SHA 镜像标签可复用原有下载及回滚路径。

实例上如需启用高级导入，在现有 API 服务的 Compose `environment` 中设置以下值。部署的 `.env` 可能包含空的 `MEDIA_PYTHON`，显式环境设置可以确保 API 使用镜像内的解释器。容量规划可参照 `compose.media.yaml` 的 API 默认上限（4 GiB、2 CPU、192 进程），并为同机数据库、Worker 和系统预留容量。使用已下载的镜像更新原有 Compose 服务。

```yaml
environment:
  MEDIA_ADVANCED_ENABLED: 'true'
  MEDIA_PYTHON: /opt/media/bin/python
  MEDIA_UHDR_LIBRARY: /opt/ultrahdr/lib/libuhdr.so
  MEDIA_HEIC_DECODER: /opt/heic/bin/heic-pq
```

访问部署站点的 `/v1/media-capabilities`，确认 `enabled`、`available`、`nativeReady` 和所用格式的 `available`。普通照片另有 `ordinaryPhotos.available`。用实际账号导入代表性素材、查看预览并下载导出件，可以验证站点权限、存储与对应格式的完整链路。

`/v1/public-config` 中的 `providerConfigured` 表示实例具有相应密钥配置，`availableOperations`、`operationStatus` 和 `imageGenerationConfigured` 表示服务端配置可路由的操作。供应商账户余额、模型授权、实时响应及异步任务交付需要各自的实际请求证据。部署检查应保留请求编号、模型、终态与产物校验信息；日志中不要包含密钥、私人原图或分享令牌。

#### 小内存实例的照片处理

API 在接到工作进程的执行名额后读取当前 Linux cgroup 和主机可用内存，保留运行服务的余量，再按像素、位深、方向与操作估计解码成本。较小容器的原生区域预览与其他隔离转换共享执行名额。相机 RAW 在读取尺寸后、解码传感器与去马赛克前检查预算。服务器资源紧张时，导入返回 `MEDIA_MEMORY`，任务说明此次导入是否保存。已入库原件的直接下载路径不经过重新显影。内存充足时仍按照原始分辨率制作母版。

以下为开发环境单任务结果。JPEG 使用固定噪声样本，CR2 来自 rawpy 的 Canon 5D Mark II 样本（提交 `2705f5b223c162c3cbc48474fe1a01c3cf09fa4f`，文件 `test/RAW_CANON_5DMARK2_PREPROD.CR2`）。测量使用 GNU time 1.9 的 `-v` 以及每 80 ms 对包含精简 Node 父进程的进程树进行 RSS 采样。共享页可能重复计数，采样也可能漏掉瞬时峰值。实例总占用还包含运行中的 API、页缓存和其他请求。

| 输入 | 字节数 | 原始尺寸 | 母版与编辑预览尺寸 | time 单进程峰值 | 采样进程树峰值 |
| --- | ---: | --- | --- | ---: | ---: |
| JPEG | 20,375,460 | 6000 × 4000 | 6000 × 4000；2508 × 1672 | 143.4 MiB（另一次冷启动 192.3 MiB） | 219.1 MiB |
| 带方向标记的 JPEG | 25,235,741 | 8000 × 6000 | 6000 × 8000；1773 × 2364 | 258.6 MiB | 332.0 MiB |
| 相机 CR2 | 26,374,329 | 5792 × 3804 传感器 | 5634 × 3752 显影；2509 × 1671 | 384.3 MiB | 503.5 MiB |

额外将任务工作集预算限定到 400 MiB 时，上述两张 JPEG 完成导入，原件 SHA-256 相同。CR2 在约 1.1 秒内返回内存不足并清理临时文件。另一次将任务预算设为 512 MiB，CR2 完整显影成功，包含父进程和加载器的树峰值达 599.2 MiB。这些参数用于复现实验，线上根据同一容器的实际余量决定。680 MiB 的 API 容器可接受的素材会随当时服务占用、画面格式及操作而变化。

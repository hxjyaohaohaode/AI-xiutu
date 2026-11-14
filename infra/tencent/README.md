# 腾讯云轻量实例自动更新

GitHub Actions 在同一次 `main` 推送的 Baseline checks 和 Frontend system redesign review 都成功后，才为该提交构建 Linux x86_64 的 API/Worker 和 Web 镜像。两个镜像属于同一个完整 SHA，并通过该 SHA 的 `cloud-<sha>` 预发行附件提供。预发行不替换面向用户的正式发布。实例定时检查当前 `main`，下载并校验 GitHub 给出的 SHA-256 摘要，不需要 GitHub 用户令牌、远程构建或向 GitHub 提供服务器密钥。

此流程适用于现有 `/home/ubuntu/xiutu-pilot` 安装。现场的 `compose.pilot.yaml` 中，API、Worker、迁移镜像使用 `xiutu-pilot-server:${XIUTU_IMAGE_REF:?Set XIUTU_IMAGE_REF}`，Web 镜像使用 `xiutu-pilot-web:${XIUTU_IMAGE_REF:?Set XIUTU_IMAGE_REF}`。手动运行 Compose 时，需从 `RELEASE` 读取并传入当前镜像标签。应用数据、发布记录、Caddy、HTTPS 和短信配置继续使用原 Compose 项目及卷。分享入口的随机值留在实例 `state/friend-link` 私有文件；不得写入源码、发布记录或公共日志。

首次安装，先检查 `RELEASE` 记录的当前全长 SHA；旧部署镜像仅有七位标签时，把该全长 SHA 另记入 `state/legacy-sha`。部署程序和单元文件由系统管理员安装：

```sh
sudo install -m 0755 infra/tencent/follow-main.sh /usr/local/sbin/xiutu-follow-main
sudo install -m 0644 infra/tencent/xiutu-follow-main.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xiutu-follow-main.timer
sudo systemctl start xiutu-follow-main.service
sudo journalctl -u xiutu-follow-main.service -n 30 --no-pager
```

更新前校验基础 Compose 文件和已应用的数据库迁移列表；普通更新保留数据库、私有素材和派发日志。换版本后检查三进程是否使用同一批镜像、HTTPS、应用及数据库健康、短信注册配置和未登录的访问边界。检查失败时恢复上一批镜像并暂停该 SHA。修复后推送新的 `main`，或在确认问题已消除后移除 `state/blocked-sha` 重试。基础 Compose 或数据库迁移变更需要单独的备份、协调更新与恢复验收，定时任务不会自动回滚数据库或清理数据卷。

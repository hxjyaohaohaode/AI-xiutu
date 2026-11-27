# Lighthouse 数据库升级

此命令在现有 /home/ubuntu/xiutu-pilot 单实例上协调数据库、API、Worker 和 Web。使用已部署的管理员身份。将本目录的 upgrade-schema.sh、follow-main.sh 设为可执行并放在同一目录。已安装的 xiutu-follow-main 名称也受支持。下载助手 fetch-release.py 与它们放在一起。

~~~bash
release_sha=$(curl -fsS https://api.github.com/repos/hxjyaohaohaode/AI-xiutu/git/ref/heads/main | jq -er .object.sha)
sudo /usr/local/sbin/upgrade-schema.sh "$release_sha"
~~~

- 正常入口先执行 follow-main --stage，要求四项 CI、发行产物摘要、服务端与 Web 镜像修订一致。脚本随后取得现有 deploy.lock，从数据库容器标签读取实际 Compose 项目及配置文件，从当前 API 和 Web 容器读取真实镜像标签，并检查当前站点。
- 营业期间先用 pg_dump 制作在线备份，恢复到隔离演练库，再运行候选镜像内的实际迁移。服务 URL 只在一次性迁移进程中重定向。演练不会启动 Worker、API 或调用模型。若旧站点有备案信息，应在运行前将准确值保存在现有 .env 的 SITE_ICP_FILING 中。
- 停写始于演练通过后的 API 和 Worker 正常停止。原库关闭连接后，脚本在同一 PostgreSQL 集群复制整库。最终逻辑备份在该副本迁移前生成，同时归档私有素材、AI 调用日志和 Docker 当前保留的服务输出。迁移完成后校验全部版本号及用户、项目、素材数量，两次换名使用同一数据库事务。
- 候选服务沿用原 Compose 项目、卷、Caddy 挂载和自定义域名。空 Web 标签后缀及高级媒体路径原子写入原 .env，启动顺序为 API、Web、Worker。验收期间，素材卷上的临时标记让 API 仅接受核验用的读取请求；业务请求和 WebSocket 握手返回 503。Worker 暂停领取任务，回收站、语音恢复和媒体清理也暂停。启动核验直接请求 API，检查 Ultra HDR JPEG、HEIC PQ、HEIC HLG 的实际解码能力报告，智能体对话及实时语音的运行时目录，以及至少 50 MiB/6400 万像素的图片限额。实际镜像、备案号、HTTPS、短信配置和匿名会话也通过后才写 RELEASE，并将提交决定同步到磁盘，随后解除标记、统一开放写入。离线原库保留原 OID，名称为 xu_old_ 开头，可供核对。
- 失败时停止当前写入者，再根据数据库 OID 确认旧库并恢复原名。已经在新库中提交的请求保存在 xu_failed_ 数据库里，未切换过的候选副本保留为 xu_new_。原素材卷和调度日志始终保留，脚本不会自动把两个不同结构的数据库合并，也不会重发供应商请求。若回滚前已有支付、扣额或生成任务，使用保留的失败库和调用日志按业务流水核对。
- 私有恢复目录为 state/schema-upgrade.*，里面有 recovery、升级前 RELEASE、环境、Compose 配置、rehearsal.dump、final.dump、assets-journal.tar、services.log 和校验摘要。可在该目录执行 sha256sum -c SHA256SUMS。各文件仅在对应步骤完成后出现。目录包含账号和服务配置，需按生产数据库备份的权限管理。原素材与归档留在同一台主机，异机备份由既有备份策略处理。
- 如断电或终端被强杀，state/upgrade-schema.pending 的第一列记录待恢复 SHA。用相同命令和 SHA 重跑。如果已经持久提交新版本，脚本完成开放写入并验证新服务；其余情况先恢复并验证原服务。恢复完成后退出码为 75，确认需要继续升级时再次运行。若 OID 不匹配，写入者保持停止，保留目录及两个数据库供排查。不要删除 pending 来跳过恢复。回滚后 blocked-sha 会阻止 timer 自动重试此版本。

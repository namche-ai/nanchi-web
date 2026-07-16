# nanchi-web
南驰官网

## 本地启动

```bash
python3 -m http.server 8080
```

访问：<http://localhost:8080/>

## 官网预约线索流程

预约表单通过同域接口 `POST /api/leads` 提交。接口会先把线索写入 SQLite，再异步发送到企业微信群机器人；机器人暂时失败不会影响客户提交，服务会自动重试。

生产数据默认位于 Docker volume `namche-leads-data`，不会保存在公开的静态网站目录中。Webhook 只存在服务器的 `deploy/.env.leads`，不能写入前端代码或提交到 Git。

### 需要提前准备

1. 在企业微信中新建一个内部群，例如“官网客户线索”。
2. 在群设置中选择“添加群机器人”，创建消息推送并复制完整 Webhook 地址。
3. Webhook 格式应类似：`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`。
4. 首次部署时通过环境变量传入 Webhook；部署脚本会通过 SSH 标准输入写入服务器的私密配置，不在本地落盘。

Webhook 相当于群机器人的发送密码。不要发到公开群、截图或写进代码仓库；如果泄露，应在企业微信里删除旧消息推送并重新生成。

### 运行线索服务

本地或服务器手工运行时，可复制忽略提交的环境文件：

```bash
cp deploy/.env.leads.example deploy/.env.leads
# 编辑 deploy/.env.leads，填入真实 WECHAT_WORK_WEBHOOK_URL
docker compose -f deploy/docker-compose.leads.yml up -d --build
```

入口 Nginx 需要与 `namche-lead-api` 加入同一个 Docker 网络，并把 `deploy/nginx-leads-location.conf` 合并到官网的 `server {}` 中。现有入口容器可以一次性连接：

```bash
docker network connect namche-leads-network deploy-nginx-1
docker exec deploy-nginx-1 nginx -t
docker exec deploy-nginx-1 nginx -s reload
```

如果入口 Nginx 会被重新创建，应在它原有的 Compose 配置里永久加入外部网络 `namche-leads-network`，避免重启后失去连接。

### 验证与导出

服务测试：

```bash
cd server
npm test
```

上线后提交一次官网预约，应该同时满足：页面显示“预约已收到”、企业微信群收到通知、数据库出现一条记录。

需要 Excel 跟进表时，可导出带 UTF-8 BOM 的 CSV：

```bash
docker exec namche-lead-api node export-leads.mjs --db /data/leads.db --output /data/leads.csv
docker cp namche-lead-api:/data/leads.csv ./leads.csv
```

## 生产部署

提交代码后执行：

```bash
scripts/deploy.sh
```

`scripts/deploy.sh` 会先构建并验证线索服务，再同步 `index.html` 和 `assets/` 到 `root@47.115.58.5:/root/official-website/static`，然后 reload 远端入口 Nginx，并验证 `https://www.namche.cn/` 返回正常官网页面。这样不会在 API 尚未可用时提前发布依赖它的新表单。

首次部署且服务器尚无 `.env.leads` 时，可在 Git Bash 中隐式输入 Webhook，避免写入命令历史：

```bash
read -rsp "WeCom Webhook: " WECHAT_WORK_WEBHOOK_URL
export WECHAT_WORK_WEBHOOK_URL
scripts/deploy.sh
unset WECHAT_WORK_WEBHOOK_URL
```

默认要求本地工作区干净，避免把未提交内容误发生产。如确实需要发布未提交改动：

```bash
scripts/deploy.sh --allow-dirty
```

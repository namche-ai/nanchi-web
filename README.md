# nanchi-web
南驰官网

## 本地启动

```bash
python3 -m http.server 8080
```

访问：<http://localhost:8080/>

## 生产部署

提交代码后执行：

```bash
scripts/deploy.sh
```

脚本会同步 `index.html` 和 `assets/` 到 `root@47.115.58.5:/root/official-website/static`，然后 reload 远端入口 Nginx，并验证 `https://www.namche.cn/` 返回正常官网页面。

默认要求本地工作区干净，避免把未提交内容误发生产。如确实需要发布未提交改动：

```bash
scripts/deploy.sh --allow-dirty
```

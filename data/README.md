# 演示经文数据

新标点和合本简体（CUVs / cmn-cu89s）。来源说明及公有领域标识：
https://ebible.org/details.php?id=cmn-cu89s

本 Demo 从用户本机已有的 structured-v1 经文集中提取书卷元数据及经文，
未复制应用代码、个人笔记、账号配置或环境文件。书卷按需加载，不把整本圣经
或缓存内容写入用户的研读状态快照。

`scripts/import-bible.py --source <本地数据目录>` 生成 66 卷、1189 章的静态资源。

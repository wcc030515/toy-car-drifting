# 玩具车漂移 · Toy Car Drifting

基于 Three.js、crashcat 和 Vite 的浏览器玩具车漂移赛车游戏，源码版本 v9.12。

## 运行

需要 Node.js 22.13+ 和 pnpm 11.25.0。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:5274/`。

## 构建

```sh
pnpm build
pnpm preview
```

`dist/` 为构建后的静态游戏，可交给支持静态文件的网站服务部署。

## 游戏

- 八款车辆可选，每款支持主车漆颜色自定义。
- 黑色沥青赛道包含急弯和连续回头弯，支持漂移和真实车辆碰撞。
- NPC 车流、落水水花与三秒救援，连续碰撞及 NPC 互撞均有音效。
- 氮气、保护罩、天降 NPC、香蕉皮、炸弹、方向混乱六种互动事件。
- 默认背景音乐关闭，手动开启为 50%；音效默认 80%，支持分别静音和保存设置。

W/S 或方向键控制油门/刹车，A/D 转向；Escape 暂停，R 重开，H 查看操作说明。数字键 1–6 触发右侧对应互动事件。触屏使用画面上的驾驶按钮。

## 目录

```text
src/       游戏逻辑、场景、界面、声音和车辆控制适配
public/    游戏实际使用的模型、贴图、音频及其授权文件
vendor/    复用的参考驾驶代码与火焰效果代码
index.html 游戏页面入口
```

本仓库保留核心源码和实际引用的素材；原始素材库、未使用素材、研究过程、测试/调试入口、旧发布包、依赖目录及构建产物均未纳入。

## 第三方来源与授权

- 参考驾驶与部分基础资源：[mrdoob/Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing)，对应 MIT 许可见 `vendor/reference/LICENSE`。
- 火焰效果：[mattatz/THREE.Fire](https://github.com/mattatz/THREE.Fire)，对应许可见 `vendor/three-fire/LICENSE` 与 `public/interaction/nitro/`。
- Kenney 模型、贴图和音效，以及其他社区音频的原始许可、出处和署名随各素材目录保留。BGM 使用 MintoDog 的 Pure Raceway。

第三方代码与素材分别遵守随附的原始授权。

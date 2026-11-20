/** 插件行 id（与 cordis.patch.yml 一致） */
export declare const name = "pet";
/**
 * **不声明任何宿主服务依赖**（故意留空）。
 *
 * DSH 启动要等整棵插件树 settle：插件行若因为等不到某个服务而一直 pending，
 * 启动流程会被挂死（桌面端表现为「desktop welcome: Web RPC failed」、窗口打不开）。
 * DSH 升级后服务改名/下线是常事，硬 inject 等于把宿主启动押在别人的服务名单上。
 *
 * 因此服务一律软取（见 ./plugin/soft-ctx）：有就用，没有就少一块功能。
 * 版本层面的兜底在 package.json 的 `engines.dsh`：不在支持区间时 DSH 直接跳过本 bundle。
 */
export declare const inject: string[];
/**
 * 宿主插件主体：注册 `/dsh-pet-7340` 前缀路由与斜杠命令（/balance /pet /chat）；ctx 暂用 any（peer 类型包本地不可解析）。
 *
 * 整个装配过程不允许抛回宿主：抛出去＝插件行激活失败，DSH 启动审计会报警；
 * 这里自己收口并留日志，宿主照常启动（宠物只是这次没起来）。
 */
export declare function apply(ctx: any): void;

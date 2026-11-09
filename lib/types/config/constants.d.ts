export declare const CORNER_SET: ReadonlySet<string>;
/** display 白名单（导出：宿主路由 POST /pet-display 写单只宠物的显示位置时复用同一份枚举）。
 *  唯一来源是 shared/config 的 PET_DISPLAYS，读写两侧必须同一份规则，不在路由里另写一个 Set。 */
export declare const PET_DISPLAY_SET: ReadonlySet<string>;
/** font.family 白名单：唯一来源是 shared/fonts 的 FONT_PRESETS，宿主只取 id 做校验。 */
export declare const FONT_FAMILY_SET: ReadonlySet<string>;
/** id 禁用的字符（Windows 文件名保留符 + 控制字符，防配置值逃逸文件路径）。
 *  同时被 thumb 路由的 petId 校验复用：那里同样是「标识符不得当路径片段」。 */
export declare const ID_FORBIDDEN: RegExp;
/** 标识符的最大长度：id 与素材根都会落成目录名，超长在部分文件系统上直接建不出来。 */
export declare const MAX_PET_ID_LENGTH = 64;
/**
 * 标识符能不能当路径片段用：非空、≤{@link MAX_PET_ID_LENGTH} 字符、不含分隔符与保留字符。
 *
 * 宠物 id、表情包素材根、thumb 的 petId 共用这一条——三者最后都拼进文件路径，
 * 分开各写一份就会出现「一处拦、另一处放行」。合法名含中文照常（用非法字符类而非 ASCII 白名单）。
 */
export declare function isValidPetId(value: string): boolean;
/**
 * 「全局默认 + 种类可覆盖」的顶层字段白名单：这些是用户级成本 / 偏好 / 环境 / 节奏参数
 * （chatMemoryRounds、两个模型、两个配图开关、对话动作联动开关与张数上限、eventsRefreshSec、
 * physics、confineToScreen、font），
 * 不是「这个种类长什么样」，所以用户层写一次应对所有条目生效；种类文件仍可在自己顶层覆盖。
 * 人设是例外：实例级 pets[].whisperPrompt 优先，回落由消费端做（./persona 的 petPersona）。
 */
export declare const GLOBAL_DEFAULT_KEYS: readonly ["physics", "font", "confineToScreen", "voiceEnabled", "voiceName", "voiceVolume", "voiceWhisperEnabled", "voiceTodoEnabled", "whisperImageEnabled", "chatImageEnabled", "chatAnimationEnabled", "chatImageLimit", "chatMemoryRounds", "whisperModel", "chatModel", "eventsRefreshSec"];
export declare function warnOnce(key: string, message: string): void;
/** 配置路径集（宿主组装好后传入，单一事实来源） */
export interface ConfigPaths {
    /** 包内 assets/config.jsonc（内置默认，绝对正确） */
    defaultFile: string;
    /** ~/.dsh/dsh-pet/main-config.jsonc（用户主配置，可编辑层；JSONC——允许注释） */
    userFile: string;
    /** 旧路径 ~/.dsh/dsh-pet/main-config.json：读取回落 + 启动时迁移（见 migrateUserConfig） */
    legacyUserFile?: string;
    /** ~/.dsh/dsh-pet/pet（文件宠物目录） */
    petDir: string;
}

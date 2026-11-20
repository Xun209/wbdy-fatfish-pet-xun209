'use strict';
/**
 * 系统托盘：桌面模式的显示开关与「退出」入口。
 *
 * 托盘是桌面模式唯一不进浏览器的入口——某只宠物改成 web/none 后窗口与右键菜单一起消失，
 * 只有托盘还能把它切回来。菜单是静态的：切换 display 后宿主会重启本进程，新进程按新配置重建。
 *
 * 「藏一下」是本次运行内的事，不写配置：写盘会把临时动作固化成永久设置——下次启动 DSH 时
 * 既没有桌面宠物也没有托盘图标（图标住在本进程，而没有桌面宠物时宿主根本不拉起本进程），
 * 用户再也切不回来（上游 issue #383）。所以配置里已经开着桌面位时，勾选框只动进程内的
 * 会话态（藏 / 叫回来）；配置里本来就没有桌面窗口（display=web/none）时才改配置。
 * @module dsh-pet/runtime/electron-helper/main/tray
 */

const path = require('node:path');

/**
 * 造托盘能力。
 *
 * @param deps.app - Electron app（退出）。
 * @param deps.Tray - Electron Tray 构造器。
 * @param deps.Menu - Electron Menu（模板 → 菜单）。
 * @param deps.nativeImage - Electron nativeImage（图标）。
 * @param deps.hostRequest - 与宿主通信（读配置、改 display、请求退出）。
 * @param deps.callbackUrl - bridge 回调地址（建托盘前要等它就绪）。
 * @param deps.isBridge - 是否由宿主以 bridge 模式拉起。
 * @param deps.appMode - 是否同进程应用模式。
 * @param deps.petRoute - 宠物路由前缀。
 * @param deps.platform - 托盘平台差异（tray-platform.js 的判定结果）。
 * @param deps.helperDir - runtime/electron-helper 的绝对目录（图标在包的 assets/ 下）。
 * @param deps.petWindows - 窗口能力（会话级藏起 / 叫回来；缺了才退回写盘的老路）。
 */
function createTray({
  app,
  Tray,
  Menu,
  nativeImage,
  hostRequest,
  callbackUrl,
  isBridge,
  appMode,
  petRoute,
  platform,
  helperDir,
  petWindows,
}) {
  const isDesktopDisplay = (display) => display === 'desktop' || display === 'both';

  /** 翻转「桌面位」：both↔web、desktop↔none——浏览器位保持不动，因此不制造新的单向门 */
  const toggleDisplay = (display) =>
    display === 'both' ? 'web' : display === 'web' ? 'both' : display === 'desktop' ? 'none' : 'desktop';

  let tray = null;

  /**
   * 这只宠物此刻是否在桌面上。
   *
   * 两个条件都要满足：配置里的桌面位开着，且本次运行没被「藏一下」藏起来。
   * 会话态只活在 Helper 进程内：配置原样不动，下次启动 DSH 桌宠照旧回来。
   * @param pet - 菜单用的宠物条目（id / display）。
   * @returns 此刻在桌面上为 true。
   */
  function isOnDesktop(pet) {
    if (!isDesktopDisplay(pet.display)) return false;
    if (!petWindows) return true;
    return !petWindows.isPetHidden(pet.id);
  }

  /** 写回某只宠物的 display：宿主写完配置会重启本进程，响应可能永远不回（同 sprite.js 的 setPetDisplay） */
  function traySetPetDisplay(id, display) {
    hostRequest('POST', petRoute + '/pet-display', JSON.stringify({ id, display })).catch((e) => {
      console.error('[workbuddy-pet-desktop-helper] tray pet-display failed:', String(e && e.message ? e.message : e));
    });
  }

  /**
   * 勾选框的点击。
   *
   * 配置里桌面位已经开着 → 只动本次运行（藏起来 / 叫回来），不写配置：藏一下是临时动作，
   * 写盘会让「下次启动 DSH 没有桌宠」变成常态（且连托盘都没了，用户再也切不回来）。
   * 配置里本来就没有桌面窗口（display=web/none）→ 只能改配置把它送上桌面（宿主重启后按新配置建窗）。
   * @param pet - 菜单用的宠物条目（id / display）。
   */
  function togglePet(pet) {
    if (isDesktopDisplay(pet.display)) {
      if (!petWindows) {
        // 没接上窗口能力（接线漏了）：退回写盘的老路，并留下一行能定位的日志
        console.error('[workbuddy-pet-desktop-helper] tray window capability missing; falling back to persistent display');
        traySetPetDisplay(pet.id, toggleDisplay(pet.display));
        return;
      }
      if (petWindows.isPetHidden(pet.id)) {
        if (!petWindows.showPet(pet.id)) {
          // 叫不回来（例如本进程启动时它就不在桌面列表里）：保持隐藏并留下日志，别假装成功了
          console.error('[workbuddy-pet-desktop-helper] cannot restore pet window: ' + pet.id);
          return;
        }
      } else {
        petWindows.hidePet(pet.id);
      }
      // 勾选状态变了：重读一次配置重建菜单（配置没变，重建只为刷新勾选）
      void refreshTray();
      return;
    }
    traySetPetDisplay(pet.id, toggleDisplay(pet.display));
  }

  /** 托盘图标：包内 logo 缩到 16×16（macOS 要模板图，否则深色菜单栏下看不见） */
  function trayIcon() {
    const file = path.join(helperDir, '..', '..', 'assets', 'logo.png');
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) {
      // 读不到图标 = 托盘不可见但菜单逻辑照跑，最难查的一种坏法：必须留下能定位的日志
      console.error('[workbuddy-pet-desktop-helper] tray icon missing or unreadable: ' + file);
      return img;
    }
    img = img.resize({ width: 16, height: 16 });
    if (platform.templateImage) img.setTemplateImage(true);
    return img;
  }

  /**
   * 托盘「退出」是否该出现。
   *
   * 独立应用与手动 start-desktop 流可以自己 app.quit()；isBridge 下本进程由宿主拉起，
   * 自己退会被当成崩溃按退避重启，必须先问宿主（GET /quit 的 canQuit）。
   * @returns 可以自己退出时为 true；探测失败按不支持处理，菜单项因此不出现。
   */
  async function canQuitSelf() {
    if (appMode || !isBridge) return true;
    try {
      return JSON.parse((await hostRequest('GET', petRoute + '/quit')).body || '{}').canQuit === true;
    } catch (e) {
      console.error('[workbuddy-pet-desktop-helper] quit capability probe failed:', String(e && e.message ? e.message : e));
      return false;
    }
  }

  /**
   * 按当前配置拼托盘菜单；返回 null 表示此时不该有托盘（开关关掉 / 配置里没有宠物）。
   *
   * 独立成函数是为了应用模式的重建：那边改 display 只重建窗口、不重启进程，
   * 勾选状态得靠这里重读一次刷新，否则菜单和配置对不上。
   */
  async function buildMenu() {
    const resp = await hostRequest('GET', petRoute + '/config');
    const merged = JSON.parse(resp.body || '{}');
    // 托盘开关（main 条目的 trayEnabled）：只有显式 false 才不建，缺失或写坏时保持建，
    // 免得一份老配置或一个错值让托盘无声消失。与下面的 pets 取自同一份成品配置。
    if (merged && merged.main && merged.main.trayEnabled === false) return null;
    // 成品聚合的形状是 { <条目>: <整份配置文档> }：顶层键不是宠物，宠物在各条目的 pets 数组里
    // （与渲染端同一契约）。托盘只要 id/name/display，所以不吹条目级字段。
    const pets = Object.values(merged)
      .flatMap((conf) => (conf && Array.isArray(conf.pets) ? conf.pets : []))
      .map((pet) => ({
        id: String((pet && pet.id) || ''),
        name: String((pet && pet.name) || '').trim(), // host 已保证 name 缺失时回落 id
        display: String((pet && pet.display) || ''),
      }))
      .filter((pet) => pet.id);
    if (!pets.length) return null; // 配置里没有任何宠物：没有可切换的对象，不建托盘
    const canQuit = await canQuitSelf();
    const quitApp = () => {
      if (!isBridge || appMode) {
        app.quit();
        return;
      }
      // 交给宿主停机：它会先停本进程再退，所以这条请求不用等结果
      hostRequest('POST', petRoute + '/quit').catch((e) => {
        console.error('[workbuddy-pet-desktop-helper] tray quit failed:', String(e && e.message ? e.message : e));
      });
    };
    return Menu.buildFromTemplate([
      ...pets.map((pet) => ({
        label: pet.name || pet.id,
        type: 'checkbox',
        // 勾 = 此刻在桌面上（配置里的桌面位 ∧ 本次运行没被藏起来）
        checked: isOnDesktop(pet),
        click: () => togglePet(pet),
      })),
      ...(canQuit ? [{ type: 'separator' }, { label: '退出', click: quitApp }] : []),
    ]);
  }

  /**
   * 建托盘：列出配置里全部宠物（含 display 为 web/none 的——它们当前勾是空的，点一下就能送回来，
   * 这是托盘相对宠物右键菜单的增量）。勾 = 当前 display 含 desktop/both。
   */
  async function startTray() {
    try {
      // 请求行要携带回调 URL，而端口在 startBridgeCallback 的 listen 回调里才有值（最多等 2s）
      for (let i = 0; isBridge && !callbackUrl() && i < 100; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const menu = await buildMenu();
      if (menu === null) return;
      tray = new Tray(trayIcon());
      tray.setToolTip('workbuddy-pet 桌面宠物');
      tray.setContextMenu(menu);
      // Windows 上 setContextMenu 只接管右键，左键默认什么都不做（macOS 相反：左键即弹菜单）
      if (platform.leftClickPopsMenu) tray.on('click', () => tray.popUpContextMenu());
    } catch (e) {
      console.error('[workbuddy-pet-desktop-helper] tray init failed:', String(e && e.message ? e.message : e));
    }
  }

  /** 重读配置并刷新菜单勾选；没建托盘时什么都不做（应用模式重建窗口后调用）。 */
  async function refreshTray() {
    if (!tray) return;
    try {
      const menu = await buildMenu();
      if (menu !== null) tray.setContextMenu(menu);
    } catch (e) {
      console.error('[workbuddy-pet-desktop-helper] tray refresh failed:', String(e && e.message ? e.message : e));
    }
  }

  return {
    start: startTray,
    refresh: refreshTray,
    exists: () => tray !== null,
    destroy() {
      if (!tray) return;
      try {
        tray.destroy();
      } catch (e) {
        console.error('[workbuddy-pet-desktop-helper] tray destroy failed:', String(e && e.message ? e.message : e));
      }
      tray = null;
    },
  };
}

module.exports = { createTray };

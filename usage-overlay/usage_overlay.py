"""
大肥魚記賬掛件 · WorkBuddy 版

在 WorkBuddy 視窗的右下角放一個 Q 版半身的掛件；點一下就彈一個氣泡，
顯示「目前這個工作階段的真實用量 / 會員訂閱剩餘額度」。

形態：獨立的 PySide6 透明置頂小窗，每秒跟一次 WorkBuddy 主視窗的位置，
把它釘在該視窗的右下角（WorkBuddy 沒開就藏起來，不會在螢幕角落亂飄）。

資料來源（全部本機只讀，不聯網）：
    ~/.workbuddy/workbuddy.db   （國際版 ~/.workbuddy-ai/workbuddy.db）
      ├─ session_usage : session_id / used / size / updated_at / credit_json
      └─ sessions     : id / title / status / model / last_activity_at

用法：
    python usage_overlay.py
    python usage_overlay.py --once      # 只印一次用量（測試用，不開窗）
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

from PySide6.QtCore import QPoint, QRect, Qt, QTimer
from PySide6.QtGui import QAction, QCursor, QIcon, QPixmap
from PySide6.QtWidgets import QApplication, QFrame, QLabel, QMenu, QWidget

HERE = Path(__file__).resolve().parent
ASSETS = HERE / 'assets'
IMG = ASSETS / 'DSniang1.png'

MARGIN = 18            # 離 WorkBuddy 視窗右下角的距離
SIZE = 112             # 半身像的顯示尺寸
BUBBLE_TTL_MS = 7000   # 氣泡停留多久
POLL_MS = 1000         # 跟隨 WorkBuddy 視窗的頻率

# 要跟隨哪個程式的視窗（預設 WorkBuddy）。
# 測試時可傳 --target-exe "DeepSeek Harness.exe" 或設 OVERLAY_TARGET_EXE，用來驗證跟隨邏輯。
TARGET_EXE = (os.environ.get('OVERLAY_TARGET_EXE') or 'workbuddy.exe').lower()
if '--target-exe' in sys.argv:
    _i = sys.argv.index('--target-exe')
    if _i + 1 < len(sys.argv):
        TARGET_EXE = sys.argv[_i + 1].lower()

STATE_DIR = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'workbuddy-whale'
STATE_DIR.mkdir(parents=True, exist_ok=True)
LOCK_FILE = STATE_DIR / 'usage-overlay.lock'


# ─────────────────────────────────────────────
# WorkBuddy 視窗定位
# ─────────────────────────────────────────────
user32 = ctypes.windll.user32


def _win_text(hwnd) -> str:
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def _process_name(pid: int) -> str:
    """視窗標題可能是空字串或不含產品名，所以改用「行程映像檔名」比對，更可靠。"""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return ''
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wt.DWORD(1024)
        if not ctypes.windll.kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return ''
        return Path(buf.value).name.lower()
    except Exception:
        return ''
    finally:
        ctypes.windll.kernel32.CloseHandle(h)


def find_workbuddy_window() -> QRect | None:
    """找 WorkBuddy 的主視窗（行程名是 WorkBuddy.exe、可見、面積最大的那個）。"""
    best = None
    best_area = 0

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _lparam):
        nonlocal best, best_area
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if _process_name(pid.value) != TARGET_EXE:
            return True
        rc = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rc))
        w, h = rc.right - rc.left, rc.bottom - rc.top
        if w < 300 or h < 300:
            return True
        area = w * h
        if area > best_area:
            best_area = area
            best = QRect(rc.left, rc.top, w, h)
        return True

    user32.EnumWindows(cb, 0)
    return best


# ─────────────────────────────────────────────
# 用量資料
# ─────────────────────────────────────────────
def db_candidates() -> list[Path]:
    home = Path.home()
    out = []
    env = os.environ.get('WORKBUDDY_HOME')
    if env:
        out.append(Path(env))
    out += [home / '.workbuddy', home / '.workbuddy-ai']
    return [d / 'workbuddy.db' for d in out]


def read_usage() -> dict:
    """讀目前這個工作階段的用量。讀不到就回傳 ok=False（呼叫端如實顯示）。"""
    for dbp in db_candidates():
        if not dbp.exists():
            continue
        try:
            conn = sqlite3.connect(f'file:{dbp.as_posix()}?mode=ro', uri=True)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                'SELECT id, title, custom_title, status, model '
                'FROM sessions WHERE deleted_at IS NULL '
                'ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT 1'
            )
            s = cur.fetchone()
            if not s:
                conn.close()
                continue
            out = {
                'ok': True,
                'db': str(dbp),
                'title': s['custom_title'] or s['title'] or '',
                'status': s['status'] or '',
                'model': s['model'] or '',
                'used': 0,
                'size': 0,
                'percent': None,
                'credit': None,
            }
            try:
                cur.execute('SELECT used, size, credit_json FROM session_usage WHERE session_id = ?', (s['id'],))
                u = cur.fetchone()
                if u:
                    out['used'] = int(u['used'] or 0)
                    out['size'] = int(u['size'] or 0)
                    if out['size'] > 0:
                        out['percent'] = round(out['used'] / out['size'] * 100, 1)
                    try:
                        if u['credit_json']:
                            out['credit'] = json.loads(u['credit_json'])
                    except Exception:
                        pass
            except Exception:
                pass
            conn.close()
            return out
        except Exception:
            continue
    return {'ok': False, 'reason': '找不到 workbuddy.db（先在 WorkBuddy 跑一次会话）'}


def usage_text(d: dict) -> tuple[str, str]:
    """回傳 (標題, 內文)。"""
    if not d.get('ok'):
        return '暫時讀不到用量', str(d.get('reason') or '未知原因')

    title = d.get('model') or d.get('title') or '目前工作階段'
    lines = []
    if d.get('model'):
        lines.append(f'模型：{d["model"]}')
    if d.get('size') and d.get('percent') is not None:
        lines.append(f'訂閱額度：已用 {d["percent"]}%')
        lines.append(f'剩餘：{max(0, d["size"] - d["used"])} / {d["size"]}')
    elif d.get('used'):
        lines.append(f'已用：{d["used"]}')
    else:
        lines.append('這個階段還沒有用量數據')
    return title, '\n'.join(lines)


# ─────────────────────────────────────────────
# 氣泡
# ─────────────────────────────────────────────
class Bubble(QFrame):
    def __init__(self, parent: QWidget):
        super().__init__(parent, Qt.FramelessWindowHint | Qt.Tool | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setStyleSheet(
            'QFrame { background: rgba(255,255,255,0.97); border: 1px solid rgba(43,43,43,0.18);'
            ' border-radius: 18px; }'
        )
        self._label = QLabel(self)
        self._label.setStyleSheet(
            'QLabel { color: #2b2b2b; background: transparent; border: none; padding: 0px; }'
        )
        self._label.setTextFormat(Qt.RichText)
        self._label.setWordWrap(True)
        self._label.setFixedWidth(250)
        lay = QVBoxLayout_(self)
        lay.setContentsMargins(16, 12, 16, 12)
        lay.addWidget(self._label)
        self.hide()

    def show_text(self, title: str, body: str) -> None:
        self._label.setText(
            f'<div style="font-size:13px;font-weight:600;color:#2b2b2b;margin-bottom:4px">{title}</div>'
            f'<div style="font-size:12px;line-height:1.5;color:#4a4a4a">{body.replace(chr(10), "<br>")}</div>'
        )
        self.adjustSize()
        self.show()
        self.raise_()


def QVBoxLayout_(parent):
    from PySide6.QtWidgets import QVBoxLayout
    lay = QVBoxLayout(parent)
    return lay


# ─────────────────────────────────────────────
# 主掛件
# ─────────────────────────────────────────────
class Overlay(QWidget):
    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_NoSystemBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setFixedSize(SIZE, SIZE)

        if IMG.exists():
            self.setWindowIcon(QIcon(str(IMG)))

        self.label = QLabel(self)
        self.label.setFixedSize(SIZE, SIZE)
        self.label.setAlignment(Qt.AlignCenter)
        pm = QPixmap(str(IMG))
        if not pm.isNull():
            self.label.setPixmap(pm.scaled(SIZE, SIZE, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        self.label.setStyleSheet('background: transparent;')
        self.label.setCursor(QCursor(Qt.PointingHandCursor))

        self.bubble = Bubble(self)
        self._bubble_timer = QTimer(self)
        self._bubble_timer.setSingleShot(True)
        self._bubble_timer.timeout.connect(self.bubble.hide)

        self.label.mousePressEvent = self._on_click

        self._menu = QMenu(self)
        act_refresh = QAction('刷新用量', self)
        act_refresh.triggered.connect(lambda: self.toggle_bubble(force=True))
        self._menu.addAction(act_refresh)
        self._menu.addSeparator()
        act_quit = QAction('退出挂件', self)
        act_quit.triggered.connect(QApplication.quit)
        self._menu.addAction(act_quit)
        self.label.setContextMenuPolicy(Qt.CustomContextMenu)
        self.label.customContextMenuRequested.connect(lambda p: self._menu.exec(self.mapToGlobal(p)))

        self._follow = QTimer(self)
        self._follow.timeout.connect(self.sync_position)
        self._follow.start(POLL_MS)

    # ── 互動 ──
    def _on_click(self, _evt):
        self.toggle_bubble()

    def toggle_bubble(self, force: bool = False):
        if self.bubble.isVisible() and not force:
            self.bubble.hide()
            return
        d = read_usage()
        title, body = usage_text(d)
        self.bubble.show_text(title, body)
        # 氣泡掛件上方
        self.bubble.adjustSize()
        bw, bh = self.bubble.width(), self.bubble.height()
        self.bubble.move(int(self.x() + (self.width() - bw) / 2), int(self.y() - bh - 10))
        self._bubble_timer.start(BUBBLE_TTL_MS)

    # ── 跟隨 WorkBuddy 視窗 ──
    def sync_position(self):
        rect = find_workbuddy_window()
        if rect is None:
            self.hide()
            return
        if not self.isVisible():
            self.show()
        nx = rect.right() - self.width() - MARGIN
        ny = rect.bottom() - self.height() - MARGIN
        if self.x() != nx or self.y() != ny:
            self.move(nx, ny)
        # 氣泡跟著走
        if self.bubble.isVisible():
            bw, bh = self.bubble.width(), self.bubble.height()
            self.bubble.move(int(self.x() + (self.width() - bw) / 2), int(self.y() - bh - 10))


def acquire_lock() -> bool:
    """單例鎖：已經有一個在跑就不再開。"""
    try:
        if LOCK_FILE.exists():
            old = int(LOCK_FILE.read_text(encoding='utf-8').strip() or 0)
            if old and pid_alive(old):
                return False
        LOCK_FILE.write_text(str(os.getpid()), encoding='utf-8')
        return True
    except Exception:
        return True


def pid_alive(pid: int) -> bool:
    """程序是否還活著。

    ⚠️ OpenProcess 回傳的是 HANDLE，64 位下預設被當成 32 位 int 會被截斷，
    `if not h` 會誤判成「程序已死」→ 單例鎖失效、掛件被重複啟動。
    所以必須顯式設定 restype/argtypes。
    """
    if pid <= 0:
        return False
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    k32 = ctypes.windll.kernel32
    k32.OpenProcess.restype = ctypes.c_void_p
    k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    k32.GetExitCodeProcess.restype = wt.BOOL
    k32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(wt.DWORD)]
    k32.CloseHandle.restype = wt.BOOL
    k32.CloseHandle.argtypes = [ctypes.c_void_p]
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return False
    try:
        code = wt.DWORD()
        if not k32.GetExitCodeProcess(h, ctypes.byref(code)):
            return False
        return code.value == STILL_ACTIVE
    finally:
        k32.CloseHandle(h)


def main() -> int:
    if '--once' in sys.argv:
        d = read_usage()
        t, b = usage_text(d)
        print(t)
        print(b)
        return 0 if d.get('ok') else 1

    if not acquire_lock():
        print('挂件已经在运行了（锁文件持有者还活着）')
        return 0

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    ov = Overlay()
    ov.show()
    ov.sync_position()

    def cleanup():
        try:
            if LOCK_FILE.exists() and LOCK_FILE.read_text(encoding='utf-8').strip() == str(os.getpid()):
                LOCK_FILE.unlink()
        except Exception:
            pass

    app.aboutToQuit.connect(cleanup)
    return app.exec()


if __name__ == '__main__':
    sys.exit(main())

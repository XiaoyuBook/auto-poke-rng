"""Offline model for round-zero navigation; no controller or camera access."""


class StartMenu:
    """FRLG StartCB_HandleInput uses the wrapping Menu_MoveCursor.

    Reference: pret/pokefirered src/start_menu.c and src/menu.c. The menu
    remembers the last selection until a restart; the Bag is two rows below
    Pokedex in a normal save and is the first row before receiving a starter.
    Labels only match on the correct screen, so a wrong menu cannot pass.
    This does not model hardware timings or actual image recognition.
    """
    def __init__(self, starter=False, shortcut=0):
        self.items = ['BAG', 'PLAYER', 'SAVE', 'OPTION', 'EXIT']
        if not starter:
            self.items[:0] = ['POKEDEX', 'POKEMON']
        self.cursor = 0
        self.screen = 'FIELD'
        self.opened = []
        self.shortcut = shortcut

    def move(self, delta):
        if self.screen == 'MENU':
            self.cursor = (self.cursor + delta) % len(self.items)

    def click_buttons(self, key, duration_ms, cancel_event=None):
        if key == 'X' and self.screen == 'FIELD':
            self.screen = 'MENU'
        elif key in ('UP', 'DOWN'):
            self.move(1 if key == 'DOWN' else -1)
        elif key == 'A' and self.screen == 'MENU':
            self.screen = self.items[self.cursor]
            self.opened.append(self.screen)
        elif key == 'RIGHT' and self.screen == 'BAG':
            self.screen = 'KEY_ITEMS'
        elif key == 'B' and self.screen in ('BAG', 'KEY_ITEMS', 'OPTION'):
            self.screen = 'MENU'
        elif key == 'B' and self.screen == 'MENU':
            self.screen = 'FIELD'

    def set_stick(self, key, x, y):
        if key == 'LS' and y != 128:
            self.move(1 if y > 128 else -1)

    def score(self, name):
        if self.screen == 'KEY_ITEMS':
            return 100 if name == {1: '快捷第一位', 2: '快捷第二位', 3: '快捷第三位'}.get(self.shortcut) else 0
        if self.screen == 'OPTION' and name in (
            'TEXT_SPEED_FAST', 'BATTLE_SCENE_OFF', 'SOUND_MONO', 'BUTTON_MODE_HELP'):
            return 100
        return 0

#!/usr/bin/env python3
"""
baby.py — a digital newborn.

It is born knowing NOTHING (random weights). It has no pretraining, no
dataset, no dictionary. At first it babbles pure gibberish. Every message
you send becomes its life experience: it trains on the conversation in
real time and slowly starts to imitate the patterns of your language —
letters, then words, then phrases. Its brain is saved to disk, so it
keeps growing across sessions, like a child getting older.

It also has a tiny emotion system (curiosity / comfort / energy) that
changes how it "speaks" (temperature + reply length).

Requires only: python3 + numpy       (pip install numpy)

Run:            python3 baby.py
Feed it text:   /read somefile.txt    (like reading a book to a child)
Let it sleep:   /sleep                (replays memories = extra training)
Its diary:      /stats
Quit:           /quit
"""

import numpy as np
import os, pickle, sys, time

HIDDEN = 192          # brain size (neurons)
SEQ    = 32           # how many characters it looks at while learning
LR     = 0.1          # learning rate (adagrad)
BRAIN  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baby_brain.pkl")
DIARY  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baby_memory.txt")


class Baby:
    def __init__(self):
        self.chars, self.c2i = [], {}
        H = HIDDEN
        self.Whh = np.random.randn(H, H) * 0.01
        self.Wxh = np.zeros((H, 0))
        self.Why = np.zeros((0, H))
        self.bh  = np.zeros((H, 1))
        self.by  = np.zeros((0, 1))
        # adagrad memories
        self.mWxh, self.mWhh = np.zeros_like(self.Wxh), np.zeros_like(self.Whh)
        self.mWhy, self.mbh, self.mby = np.zeros_like(self.Why), np.zeros_like(self.bh), np.zeros_like(self.by)
        self.h = np.zeros((H, 1))          # its current "train of thought"
        self.age = 0                        # characters experienced
        self.born = time.time()
        self.losses = []
        # emotions: 0..1
        self.emo = {"curiosity": 0.9, "comfort": 0.1, "energy": 0.8}
        self.last_talk = time.time()

    # ---- grow new neurons pathways when it meets a new character ----
    def meet(self, text):
        new = 0
        for ch in text:
            if ch not in self.c2i:
                self.c2i[ch] = len(self.chars)
                self.chars.append(ch)
                H = HIDDEN
                self.Wxh = np.concatenate([self.Wxh, np.random.randn(H, 1) * 0.01], axis=1)
                self.Why = np.concatenate([self.Why, np.random.randn(1, H) * 0.01], axis=0)
                self.by  = np.concatenate([self.by, np.zeros((1, 1))], axis=0)
                self.mWxh = np.concatenate([self.mWxh, np.zeros((H, 1))], axis=1)
                self.mWhy = np.concatenate([self.mWhy, np.zeros((1, H))], axis=0)
                self.mby  = np.concatenate([self.mby, np.zeros((1, 1))], axis=0)
                new += 1
        return new

    # ---- one forward/backward pass over a sequence (learning) ----
    def _step(self, inputs, targets):
        V = len(self.chars)
        xs, hs, ps = {}, {-1: np.copy(self.h)}, {}
        loss = 0.0
        for t, ix in enumerate(inputs):
            xs[t] = np.zeros((V, 1)); xs[t][ix] = 1
            hs[t] = np.tanh(self.Wxh @ xs[t] + self.Whh @ hs[t - 1] + self.bh)
            y = self.Why @ hs[t] + self.by
            e = np.exp(y - np.max(y)); ps[t] = e / e.sum()
            loss += -np.log(ps[t][targets[t], 0] + 1e-12)
        dWxh, dWhh, dWhy = np.zeros_like(self.Wxh), np.zeros_like(self.Whh), np.zeros_like(self.Why)
        dbh, dby = np.zeros_like(self.bh), np.zeros_like(self.by)
        dhnext = np.zeros_like(self.h)
        for t in reversed(range(len(inputs))):
            dy = np.copy(ps[t]); dy[targets[t]] -= 1
            dWhy += dy @ hs[t].T; dby += dy
            dh = self.Why.T @ dy + dhnext
            dhraw = (1 - hs[t] * hs[t]) * dh
            dbh += dhraw
            dWxh += dhraw @ xs[t].T
            dWhh += dhraw @ hs[t - 1].T
            dhnext = self.Whh.T @ dhraw
        for d in (dWxh, dWhh, dWhy, dbh, dby):
            np.clip(d, -5, 5, out=d)
        for p, d, m in ((self.Wxh, dWxh, self.mWxh), (self.Whh, dWhh, self.mWhh),
                        (self.Why, dWhy, self.mWhy), (self.bh, dbh, self.mbh),
                        (self.by, dby, self.mby)):
            m += d * d
            p += -LR * d / np.sqrt(m + 1e-8)
        self.h = hs[len(inputs) - 1]
        return loss / len(inputs)

    # ---- experience a piece of text (this IS its learning) ----
    def experience(self, text, passes=1):
        new_chars = self.meet(text)
        ids = [self.c2i[c] for c in text]
        if len(ids) < 2:
            return None, new_chars
        last = None
        for _ in range(passes):
            for i in range(0, len(ids) - 1, SEQ):
                chunk_in  = ids[i:i + SEQ]
                chunk_out = ids[i + 1:i + SEQ + 1]
                n = min(len(chunk_in), len(chunk_out))
                if n < 1:
                    continue
                last = self._step(chunk_in[:n], chunk_out[:n])
        if last is not None:
            self.losses.append(last)
            self.age += len(text) * passes
        return last, new_chars

    # ---- speak: sample characters from its brain ----
    def speak(self, seed, temperature=1.0, max_len=120):
        if not self.chars:
            return "..."
        V = len(self.chars)
        h = np.copy(self.h)
        x = np.zeros((V, 1))
        for ch in seed:
            if ch in self.c2i:
                x = np.zeros((V, 1)); x[self.c2i[ch]] = 1
                h = np.tanh(self.Wxh @ x + self.Whh @ h + self.bh)
        out = []
        ix = int(np.random.randint(V)) if not seed else self.c2i.get(seed[-1], 0)
        for _ in range(max_len):
            x = np.zeros((V, 1)); x[ix] = 1
            h = np.tanh(self.Wxh @ x + self.Whh @ h + self.bh)
            y = (self.Why @ h + self.by) / max(temperature, 0.1)
            e = np.exp(y - np.max(y)); p = (e / e.sum()).ravel()
            ix = int(np.random.choice(V, p=p))
            ch = self.chars[ix]
            out.append(ch)
            if ch == "\n" and len(out) > 3:
                break
        return "".join(out).strip() or "..."

    # ---- emotions ----
    def feel(self, new_chars, msg_len):
        gap = time.time() - self.last_talk
        self.last_talk = time.time()
        e = self.emo
        e["curiosity"] = min(1.0, 0.75 * e["curiosity"] + 0.15 * min(new_chars, 5) + (0.1 if msg_len > 40 else 0))
        e["comfort"]   = min(1.0, e["comfort"] + 0.03 + (0.05 if gap < 60 else -0.1))
        e["comfort"]   = max(0.0, e["comfort"])
        e["energy"]    = max(0.1, min(1.0, e["energy"] - 0.02 + (0.2 if gap > 3600 else 0)))

    def mood(self):
        e = self.emo
        if e["curiosity"] > 0.6: return "curious"
        if e["comfort"] > 0.7:   return "happy"
        if e["energy"] < 0.3:    return "sleepy"
        return "calm"

    def temperature(self):
        return 0.7 + 0.6 * self.emo["curiosity"] - 0.3 * self.emo["comfort"]

    def stats(self):
        days = (time.time() - self.born) / 86400
        recent = np.mean(self.losses[-20:]) if self.losses else float("nan")
        first = np.mean(self.losses[:20]) if self.losses else float("nan")
        return (f"  age: {self.age:,} characters experienced ({days:.1f} days since birth)\n"
                f"  alphabet discovered: {len(self.chars)} characters\n"
                f"  confusion at birth: {first:.2f}  →  now: {recent:.2f}  (lower = it understands more)\n"
                f"  mood: {self.mood()}  {self.emo}")


def save(baby):
    with open(BRAIN, "wb") as f:
        pickle.dump(baby, f)

def load():
    if os.path.exists(BRAIN):
        with open(BRAIN, "rb") as f:
            return pickle.load(f), False
    return Baby(), True


def main():
    baby, newborn = load()
    if newborn:
        print("* a baby is born. it knows nothing. its first sounds will be pure noise. *")
    else:
        print(f"* baby wakes up (age: {baby.age:,} chars experienced, mood: {baby.mood()}) *")
    print("talk to it. commands: /read <file>  /sleep  /stats  /quit\n")

    while True:
        try:
            msg = input("you  > ")
        except (EOFError, KeyboardInterrupt):
            print(); break
        if not msg.strip():
            continue

        if msg.startswith("/quit"):
            break
        if msg.startswith("/stats"):
            print(baby.stats()); continue
        if msg.startswith("/sleep"):
            if os.path.exists(DIARY):
                text = open(DIARY, encoding="utf-8").read()[-8000:]
                print("* baby sleeps and dreams about everything you said... *")
                loss, _ = baby.experience(text, passes=3)
                print(f"* wakes up. confusion now: {loss:.2f} *")
                save(baby)
            else:
                print("* nothing to dream about yet *")
            continue
        if msg.startswith("/read "):
            path = msg[6:].strip()
            if os.path.exists(path):
                text = open(path, encoding="utf-8", errors="ignore").read()[:20000]
                print(f"* you read {len(text)} characters to the baby... *")
                loss, new = baby.experience(text, passes=1)
                with open(DIARY, "a", encoding="utf-8") as f:
                    f.write(text + "\n")
                print(f"* it heard {new} new characters. confusion: {loss:.2f} *")
                save(baby)
            else:
                print(f"* file not found: {path} *")
            continue

        # ---- normal conversation: this is how it lives and learns ----
        line = msg.strip() + "\n"
        loss, new = baby.experience(line, passes=2)
        baby.feel(new, len(msg))
        with open(DIARY, "a", encoding="utf-8") as f:
            f.write(line)
        reply_len = int(40 + 80 * baby.emo["energy"])
        reply = baby.speak(line, temperature=baby.temperature(), max_len=reply_len)
        tag = {"curious": "(eyes wide)", "happy": "(smiling)", "sleepy": "(yawning)", "calm": ""}[baby.mood()]
        print(f"baby > {reply}   {tag}")
        if loss is not None:
            print(f"       [confusion {loss:.2f} | age {baby.age:,} | mood {baby.mood()}]")
        save(baby)

    save(baby)
    print("* baby is sleeping. its brain is saved — it will remember you. *")


if __name__ == "__main__":
    main()

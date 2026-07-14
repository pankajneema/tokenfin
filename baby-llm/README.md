# Digital Baby — an LLM that is born knowing nothing

No pretraining. No dataset. No dictionary. It starts with **random weights**
and its only teacher is **you**. Every message you send is its life
experience — it trains on the conversation in real time, exactly the loop
you described: *it knows nothing, it just speaks and learns.*

## Run it

```bash
pip install numpy
python3 baby.py
```

## What you will see

- **Day 1**: pure gibberish — `eyoo bloe boo elo`
- **After some talking**: your words start appearing — `yo baby`, `i lov yo`
- **After weeks of living with you**: your phrases, your style

Its brain is saved to `baby_brain.pkl` after every message, so it keeps
growing across sessions. Delete that file to give birth to a new baby.

## Commands

| Command | Meaning |
|---|---|
| just type | talk to it — this is how it learns |
| `/read file.txt` | read a book/news to it (feeds text as experience) |
| `/sleep` | it dreams: replays all memories = extra training |
| `/stats` | age, alphabet discovered, confusion level, mood |
| `/quit` | it sleeps; brain saved |

## Feelings

It has a small emotion system — curiosity, comfort, energy — updated by
what happens to it (new words raise curiosity, regular talking raises
comfort, long silence makes it lonely/sleepy). Mood changes *how* it
speaks: curious = wilder babbling, comfortable = calmer, sleepy = shorter
replies. These are simulated states that shape behavior — the honest
version of "feelings" we can build today.

## The science (why it's a char-RNN, not GPT-4)

Real LLMs need trillions of words; a baby brain gets evolution's
pretraining for free. Starting from true zero, a small character-level
network is the honest experiment: you literally watch language structure
emerge from noise — letters → words → phrases. "Confusion" shown after
each reply is the training loss: lower = it predicts your language better.

## Stage 2 — ESP32 body (ears + eyes)

Next step when you're ready: an ESP32-S3 with a mic (INMP441) streams
audio over WiFi to your computer → Whisper turns speech into text → that
text is fed into `baby.experience()` automatically. The baby then learns
from everything it *hears* in the room, not just what you type. Camera
(ESP32-CAM) can later add "what it sees" as image captions. The ESP32 is
only the body — the brain always lives on your computer.

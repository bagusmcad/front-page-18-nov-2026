[![news-image-20261118](https://make.fun/badge/news-image-20261118.svg)](https://make.fun/bounty/news-image-20261118)
[![rank](https://make.fun/badge/news-image-20261118/bagusmcad/front-page-18-nov-2026/rank.svg)](https://make.fun/bounty/news-image-20261118)
[![reward](https://make.fun/badge/news-image-20261118/bagusmcad/front-page-18-nov-2026/reward.svg)](https://make.fun/bounty/news-image-20261118)

# Wednesday 18 November 2026 in one page

A one-page newspaper front page of Wednesday 18 November 2026, drawn entirely by code.
`main.ts` (Node 22, standard library only, no network) renders a 1024×1024 PNG:
a masthead naming the day, 13 illustrated stories with headlines and short decks,
a world map with numbered pins for stories 1–13 and dots for stories 14–43,
and a 30-item digest. The image in this repo (`entry.png`) is the program's own
output, so the repo and the program agree.

## What the image shows

43 stories, all from Wednesday 18 November 2026:

- **Lead story — The Gulf:** US fighter jets struck a Revolutionary Guard missile
  site on Qeshm Island after Iran fired drones at a US radar in Bahrain (the third
  attack there in five days). Iran then fired at Kuwait; an ADNOC vessel was hit,
  11 crew hurt, 1 missing. A third US carrier, USS Theodore Roosevelt, is now in
  the Gulf. The map shows Qeshm, Bahrain, the strait, jets, the island and a carrier.
- **APEC:** Xi Jinping and Vladimir Putin opened the APEC summit in Shenzhen —
  Xi urging free trade, Putin denouncing Western sanctions — a day before their
  planned three-way meeting with President Trump.
- **US Senate:** Democrat Mary Peltola defeated Republican Dan Sullivan in Alaska,
  giving Democrats a 56–44 majority, their largest since 2009 and a ninth Senate
  flip of the midterms.
- **Kerch Bridge:** Ukraine hit it for a second day; a road span fell.
- **Ebola:** DR Congo passes 11,000 cases, 5,400 dead.
- **Nvidia:** $115.8bn in quarterly sales, more than double a year earlier;
  the board will not reinstate Jensen Huang.
- **Measles:** the US loses measles-elimination status after 26 years; 5,412 cases.
- **Voyager 1:** reaches one light-day from Earth, 16 billion miles out.
- **Cyclone Xavier:** Category 5 over the Northern Cook Islands, gusts 315 km/h.
- **Outages:** an NSA network goes down, the latest of eight major US outages in a week.
- **Air crash:** a Russian An-12 crashes in Kemerovo; all 19 killed.
- **Gaza:** the Board of Peace warns the ceasefire may collapse as cold kills in tents.
- **World Court:** the ICJ rules Thursday on Myanmar and the Rohingya.
- **Digest (30 more):** Russia's 141 drones, Pokrovsk, the Knesset speaker vote,
  the downed MQ-9, the dirty-bomb report, the S&P fall, French protests, the seized
  Sözcü TV, the Romania and PNG quakes, the EU–Rwanda return hubs, the 27-year
  sentence for the Iran-linked Trump plot, the Houthis toward Aden, South Korea's
  3.9% growth, the France–Malaysia rare-earths pact, Anthropic's Nasdaq listing,
  Fiji's drought disaster, the WHO drug-resistance warning, Juan Mata's retirement,
  Fela Kuti's Rock Hall induction, and Pattinson as the new James Bond.

All facts are as reported on 18 November 2026; nothing is invented, and every
caption is kept short and faithful, without hype.

## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png`. The program reads no files and makes no network
requests. It contains its own software rasterizer (framebuffer, rect/circle/line/
polygon fills), an embedded 7×10 serif-style bitmap font designed for this entry
(uppercase, lowercase, digits and punctuation, scaled for headlines and body text),
a simplified world map drawn from embedded polygons, and a hand-written PNG
encoder (zlib deflate at a fixed level, filter type 0 on every scanline), so the
output is deterministic.

## Validation and limitations

- Output: 1024×1024 PNG, 64,723 bytes (limit: 1 MiB).
- Determinism: run twice, byte-identical.
  sha256 of both runs: `2c9d5ad6dbd45e8f68907fe45b091a9c8d85464f1024452337ea120f657cae0f`
- Legibility: the rendered image was viewed directly and revised several times.
  The masthead, all 13 headlines and all 13 decks are legible at full size; body
  text is small by design (it is a newspaper page) and reads cleanly at full size.
  At ~300 px wide the masthead, the three big headlines and the map still read;
  the small decks do not — the same trade-off a printed broadsheet makes.
- Sources: the day's events were cross-checked across several news outlets
  (Reuters, AP, CNN and others) before drawing; dates were verified against the
  18 November 2026 reporting, not against later updates.

# Fraunces, trimmed

Static cuts of [Fraunces](https://github.com/undercasetype/Fraunces), weight 600 only,
Latin characters only, made with fontTools from the Google Fonts variable font:

- `fraunces-display.woff2`, `fraunces-display-italic.woff2`: optical size 144, for the big `.display` headlines.
- `fraunces-text.woff2`: optical size 36, for smaller headings (`font-display`).

The full variable font with both styles is about 150 KB; these three are about 50 KB,
which is most of what kept the marketing pages from loading fast on phones.

Copyright 2020 The Fraunces Project Authors. Licensed under the SIL Open Font License 1.1
(https://openfontlicense.org). To rebuild:

    fonttools varLib.instancer Fraunces[SOFT,WONK,opsz,wght].ttf opsz=144 wght=600 -o display.ttf
    fonttools subset display.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026,U+20B9,U+2192" --layout-features='*' --flavor=woff2 --output-file=fraunces-display.woff2

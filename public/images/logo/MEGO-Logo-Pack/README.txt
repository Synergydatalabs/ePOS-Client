MEGO LOGO PACK
==============
Brand blue  #0C3987      (the wordmark colour)
Dark navy   #0E234E      (product header/footer band)
Accent blue #006AFF      (buttons, links, totals)

contact-sheet.png  -  visual index of everything below


WORDMARK  (aspect ratio 3.006 : 1)
----------------------------------
Vector - use these wherever you can
  MEGO-wordmark-blue.svg           brand blue, for light backgrounds
  MEGO-wordmark-white.svg          white, for dark backgrounds
  MEGO-wordmark-currentColor.svg   inherits CSS `color` - inline this in HTML
                                   and recolour with one property

Transparent PNG, 300 DPI
  MEGO-wordmark-blue-4000.png      4000 x 1331  print, slides, large web
  MEGO-wordmark-white-4000.png     4000 x 1331  same, for dark backgrounds
  MEGO-wordmark-blue-360.png        360 x 120   email, small web (3x for 120px)
  MEGO-wordmark-white-360.png       360 x 120   email on a dark header

Flattened JPG, 300 DPI  (JPEG has no transparency, so each is baked onto a bg)
  MEGO-wordmark-blue-on-white.jpg  blue on #FFFFFF  - docs, email attachments
  MEGO-wordmark-white-on-navy.jpg  white on #0E234E - decks with dark slides


ICON  -  the M only, square
---------------------------
  MEGO-M-blue.svg / -512.png    blue M, transparent   light backgrounds
  MEGO-M-white.svg / -512.png   white M, transparent  dark backgrounds
  MEGO-M-tile.svg / -512.png    white M on a rounded blue tile

  favicon.ico        blue M, transparent
  favicon-tile.ico   white M on rounded blue tile
  Both .ico files pack 16/24/32/48/64/128/256 px, each rendered from the
  vector rather than downscaled from one bitmap.

Which favicon: favicon-tile.ico holds up better in a crowded tab strip and
against dark browser themes. favicon.ico is cleaner but thinner at 16px.

For PWA / mobile web:
  apple-touch-icon        -> MEGO-M-tile-512.png   (needs an opaque tile)
  manifest maskable icon  -> MEGO-M-tile-512.png
  manifest any icon       -> MEGO-M-blue-512.png


PICKING A FILE
--------------
  Light background      blue
  Dark background       white
  Colour set in CSS     currentColor svg, inlined
  Email                 the 360px PNG, hosted at a URL (clients block data: URIs)
  Print / large format   the svg, or the 4000px PNG
  Needs no transparency  the jpg


RENAMED SINCE THE FIRST PACK
----------------------------
The old names were ambiguous - "MEGO-M-blue-512.png" was actually the blue
TILE with a white M, not a blue M. Current mapping:

  old                        ->  new
  MEGO-logo.png              ->  wordmark/MEGO-wordmark-blue-4000.png
  MEGO-logo.jpg              ->  wordmark/MEGO-wordmark-blue-on-white.jpg
  mego-logo.svg              ->  wordmark/MEGO-wordmark-blue.svg
  MEGO-M-512.png             ->  icon/MEGO-M-blue-512.png
  MEGO-M-blue-512.png        ->  icon/MEGO-M-tile-512.png
  favicon.ico                ->  icon/favicon.ico          (unchanged)
  favicon-blue.ico           ->  icon/favicon-tile.ico

New in this pack: every white variant, all three .svg icon files,
MEGO-wordmark-currentColor.svg, MEGO-wordmark-white-on-navy.jpg,
the 360px sizes, and contact-sheet.png.


HOW THESE WERE MADE
-------------------
The wordmark was isolated from the MEGO Pay lockup and vector-traced, so
every raster file here is rendered from curves - nothing was upscaled.

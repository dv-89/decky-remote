# Third-party notices

The Rollup configuration adapts the Decky globals and manifest injection pattern from [@decky/rollup](https://github.com/SteamDeckHomebrew/decky-rollup), under BSD-3-Clause. The runtime bundle includes [@decky/api](https://github.com/SteamDeckHomebrew/loader-api) 1.1.3, under LGPL-2.1. Its original source, distributed JavaScript, package metadata, and full license are in `third_party/decky-api/`. Decky supplies React and @decky/ui at runtime; they are external to this plugin bundle. The UI library is LGPL-2.1, and React is MIT. Build tools and desktop preview dependencies are recorded in package-lock.json.

To use a modified @decky/api, run `npm ci`, replace the appropriate files in `node_modules/@decky/api/dist/` with your modified JavaScript (or compile the included TypeScript source), then run `npm run build` and `npm run package`. Plugin source and build configuration are included with the release so the combined bundle can be rebuilt. The plugin's own code remains MIT; the included library retains its LGPL license. There are no restrictions on modifying or debugging the library for your use.

## BSD 3-Clause License — Steam Deck Homebrew

Copyright (c) 2024, Steam Deck Homebrew

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

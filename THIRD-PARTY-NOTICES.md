# Third-party notices

imbatranim-office is licensed under the AGPL-3.0-only (see [LICENSE](LICENSE)).
Code translated or copied into this repository from another project keeps that
project's copyright and licence notice here: one section per source, naming the
project, its licence, the files here that carry its code, and the notice text.
The ArtCraft crafts are the usual source (see
[corpus/wiki/craft-reference.md](corpus/wiki/craft-reference.md)); their names
and logos are never used.

Dependencies installed from npm carry their own licences in `node_modules` and
are not listed here. The kit snapshot in `vendor/imbatranim-ui` is imbatranimOS
code under the same AGPL-3.0-only licence.

No translated code yet.

## CADCraft: a sample drawing (CAD test fixture)

- Source: <https://github.com/storytold/cadcraft>, `examples/apartment.dxf` at
  commit `896a390b4272e89bd5de416f3afaf44292670fd4`, unchanged (sha256
  `0d3bc019a4cc69f5338845a85f033f15964d5694eba0db35cfa94cbd15e732e3`). Its
  `ATTRIBUTION.md` lists it as an original sample drawing by the CADCraft
  contributors, MIT OR Apache-2.0.
- Here: `apps/cad/fixtures/apartment.dxf`, used by CAD's tests only. No CADCraft
  code was translated for CAD; its documents were read for behaviour.
- Taken under the MIT License:

```
MIT License

Copyright (c) 2026 ArtCraft Team and the CADCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

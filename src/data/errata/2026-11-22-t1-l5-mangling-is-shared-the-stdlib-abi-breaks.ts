import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t1-l5-mangling-is-shared-the-stdlib-abi-breaks',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t1.l5'],
  title: 'On Linux the C++ breakage is the standard library, not each compiler\'s mangling',
  before: 'Name mangling was taught as why C++ interop breaks across compilers, each compiler mangling signatures differently.',
  after:
    'GCC and Clang share the Itanium C++ ABI and mangle alike on Linux. Mangling is why C++ needs extern "C" for a stable boundary; the cross-library breakage is the standard library (libstdc++ against libc++, the __cxx11 tag).',
  why: 'An "undefined symbol: _ZN...__cxx11..." error means two libraries were built against different standard-library ABIs. Blaming the compiler sends you to the wrong fix.',
  source: {
    url: 'https://gcc.gnu.org/onlinedocs/libstdc++/manual/using_dual_abi.html',
    title: 'libstdc++ manual, Dual ABI: linker errors involving std::__cxx11 or [abi:cxx11] mean different _GLIBCXX_USE_CXX11_ABI values',
  },
} satisfies Erratum

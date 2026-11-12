export type MakeupBrushId =
  'base' | 'shadow' | 'liner' | 'brow' | 'blush' | 'lip' | 'contour' | 'highlight' | 'undereye';

type ColorFamily = { name: string; shades: readonly string[] };

function family(name: string, shades: string): ColorFamily {
  return { name, shades: shades.split(' ').map((shade) => '#' + shade) };
}

// Editable display swatches, organized by undertone and depth. They are not
// calibrated replicas of physical pigments or predictions of their appearance on skin.
export const makeupPalettes = {
  base: [
    family('中性色', 'dfb69e f3e0cf ebcbb4 d6a688 bd8b6c a36e52 83553d 613c2e'),
    family('冷调', 'f4ded9 ecc9bf e0ae9f c89081 b27b6e 965e52 79493f 52312b'),
    family('暖调', 'f5dfbd edc99f deb18a c99468 b47e56 976241 764a30 533322'),
    family('橄榄调', 'e9d5b4 dcc29a cbb086 b79c6f 9c8258 826943 675337 4b3928'),
  ],
  shadow: [
    family('玫瑰色', '9a6b75 d9b4ae c69497 b27986 946073 765064 654456 4d3548'),
    family('裸色', 'e2c4a9 d5af94 c5967a ae7e65 906851 755543 61483c 493630'),
    family('暖棕', 'e4b690 ce9670 b77853 9c5d3e 834a35 6c3a2b 583124 45271f'),
    family('珠光色', 'f3dfcf e8cab0 dbb9ab cca3a8 b6a2b6 cbb277 ac8256 8c625a'),
    family('烟熏色', 'afa09a 90847e 78686c 60545d 514654 443949 393343 302934'),
    family('彩色', 'a486ae 76547b 574a78 3b5677 477178 627460 74825a 8b644e'),
  ],
  liner: [
    family('深色', '302329 201d20 16131c 33323b 3c3738 50434b 5f5355 756562'),
    family('棕色', '53382f 3c2825 49302a 624135 744d3d 8a5c49 a27058 c38c6f'),
    family('冷调', '56374d 402c47 553f67 2e3c65 263b51 2e504a 4f5745 635a71'),
    family('珠光色', '937b69 b29b8a d1b4a2 e0c5ae ecd3bc d0b7c5 b5a4c8 a28e7d'),
  ],
  brow: [
    family('中性色', '725046 34272a 493530 554842 6d6157 7d6f66 9b8269 a8876b'),
    family('冷调', '3b363a 4e4648 564e4a 685d58 786c68 8a7b75 9c8d82 b3a293'),
    family('暖棕', '48302a 614136 755043 8b6754 9f7e67 ad8566 ba9673 cca986'),
  ],
  blush: [
    family('玫瑰色', 'b5687e de9da9 cf899a c1788b b16b7d 9e566d 8e4960 783d55'),
    family('蜜桃色', 'f2b4a2 eba48e de947c d08570 c57869 bb6e5f a75d52 935149'),
    family('裸色', 'dfac96 d4a18e c69480 b88574 ae796e a47164 93615a 80534c'),
    family('冷粉', 'efa9bd e596b0 d481a1 c37498 b16591 a05683 8d4773 783962'),
    family('莓果色', 'ca7790 b76683 a95173 984365 8b3a60 7e3257 6b2b4c 58243e'),
  ],
  lip: [
    family('玫瑰色', 'a54a61 d38791 c55c6a b85e70 aa5267 98445a 893b50 763247'),
    family('裸色', 'daaa9a cb9788 bd887b b08078 a7756d 98665b 85574f 744943'),
    family('红棕', 'c56e57 b6604e ab5142 a4493b 954437 85382e 752e28 682923'),
    family('经典红', 'de7772 ce5e5b bf4c50 af3945 9d303d 8d232f 7d2434 6f2030'),
    family('莓果色', 'c17a93 b16885 a75b7b 964a6b 863f60 77344d 652d42 54263b'),
    family('珊瑚色', 'efa08e e99180 db816f d47865 ca694d b96151 a65347 914a40'),
  ],
  contour: [
    family('中性色', '846151 d4b6a2 c3a28d b2907d a17d6a 735343 5e4339 49332c'),
    family('冷灰', 'c7b2a8 b9a297 a08778 958075 826d62 705b53 5d4a44 493b39'),
    family('暖棕', 'd2a98c be9477 aa8267 9c745e 89624d 754e3b 613f32 4c3127'),
    family('橄榄调', 'c2ac8c b29c7d a08a6b 8e795c 79664e 655441 534434 40362b'),
  ],
  highlight: [
    family('香槟色', 'ebcdb2 f5e7d1 f0dbc1 e6c5a6 dbb896 cda887 bf9473 ab8065'),
    family('珠光色', 'f2ece6 e6e6eb e4d9e5 d5c1e7 c9d4df b7bfde c3abc8 ad93b8'),
    family('玫瑰色', 'f4d9d0 edc9bf e7baa9 e3aa94 d89a8c c78980 b77a75 9e665f'),
    family('金铜色', 'f0dbad e9c887 d8b374 cda070 b88c5d a87951 936546 7e5239'),
  ],
  undereye: [
    family('中性色', 'e7c0aa f4e4cf ecd6c5 e6c8b5 debb9c d2ab8b bc9376 a77e64'),
    family('冷粉', 'f4e0df ebd1d0 e4bdc4 d6b5ba cda7a1 b99492 a78282 906c6d'),
    family('蜜桃色', 'f4deca efd1b9 e8c4ab dcb298 cda58c bf9378 a87b64 8e6552'),
  ],
} satisfies Record<MakeupBrushId, readonly ColorFamily[]>;

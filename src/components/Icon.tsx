import Svg, { Circle, Path } from 'react-native-svg';

export type IconName = 'camera' | 'image' | 'info' | 'lab' | 'wifi-off' | 'dots' | 'auto' | 'frame' | 'rotate' | 'arrow-right' | 'plus' | 'check' | 'chevron-down' | 'compare' | 'close' | 'play' | 'pause' | 'edit' | 'trash' | 'share' | 'file';

type Props = { name: IconName; size?: number; color: string };

/** Minimal stroke icons (24x24 grid) so the app needs no icon font. */
export function Icon({ name, size = 24, color }: Props) {
  const stroke = { stroke: color, strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'camera' && (
        <>
          <Path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.6A1.5 1.5 0 0 1 10 3.75h4a1.5 1.5 0 0 1 1.2.65L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" {...stroke} />
          <Circle cx={12} cy={12.5} r={3.4} {...stroke} />
        </>
      )}
      {name === 'image' && (
        <>
          <Path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z" {...stroke} />
          <Circle cx={9} cy={9} r={1.6} {...stroke} />
          <Path d="m4.5 17 4.5-4.5 3 3 3-3.5 4.5 5" {...stroke} />
        </>
      )}
      {name === 'info' && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 11v5.2M12 7.8v.1" {...stroke} />
        </>
      )}
      {name === 'lab' && (
        <Path d="M9.5 3.5h5M10.5 3.5v5.6L5.2 17.6A2 2 0 0 0 6.9 20.5h10.2a2 2 0 0 0 1.7-2.9l-5.3-8.5V3.5M8 14.5h8" {...stroke} />
      )}
      {name === 'wifi-off' && (
        <>
          <Path d="M3.5 3.5l17 17M8.6 8.9A12 12 0 0 0 2.5 12.2M5.6 12.4a8 8 0 0 1 3.8-2M16.5 12.2a8 8 0 0 0-2.3-1.4M21.5 8.8A15 15 0 0 0 12 5.5M9 15.9a4.3 4.3 0 0 1 6 0" {...stroke} />
          <Circle cx={12} cy={19} r={0.6} {...stroke} />
        </>
      )}
      {name === 'auto' && (
        <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.4 2.4M15.6 15.6 18 18M18 6l-2.4 2.4M8.4 15.6 6 18" {...stroke} />
      )}
      {name === 'frame' && (
        <Path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" {...stroke} />
      )}
      {name === 'rotate' && <Path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2" {...stroke} />}
      {name === 'arrow-right' && <Path d="M5 12h14M13 6l6 6-6 6" {...stroke} />}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...stroke} />}
      {name === 'check' && <Path d="m5 12.5 4.5 4.5L19 7.5" {...stroke} />}
      {name === 'chevron-down' && <Path d="m6 9 6 6 6-6" {...stroke} />}
      {name === 'compare' && <Path d="M12 4v16M8 8l-4 4 4 4M16 8l4 4-4 4" {...stroke} />}
      {name === 'share' && <Path d="M12 15V4M8 8l4-4 4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" {...stroke} />}
      {name === 'file' && <Path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M8.5 13h7M8.5 16.5h5" {...stroke} />}
      {name === 'edit' && <Path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3" {...stroke} />}
      {name === 'trash' && <Path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" {...stroke} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...stroke} />}
      {name === 'play' && <Path d="M8 5.5v13l11-6.5z" {...stroke} />}
      {name === 'pause' && <Path d="M8.5 5.5v13M15.5 5.5v13" {...stroke} strokeWidth={2.6} />}
      {name === 'dots' && (
        <>
          <Circle cx={5.5} cy={12} r={1.3} fill={color} />
          <Circle cx={12} cy={12} r={1.3} fill={color} />
          <Circle cx={18.5} cy={12} r={1.3} fill={color} />
        </>
      )}
    </Svg>
  );
}

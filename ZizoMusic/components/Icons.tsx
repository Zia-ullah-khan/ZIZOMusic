import React from "react";
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

interface IconProps
{
    size?: number;
    color?: string;
    filled?: boolean;
    isMuted?: boolean;
}

export function PlayIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <Polygon points="6 3 20 12 6 21 6 3" />
        </Svg>
    );
}

export function PauseIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <Rect x="6" y="4" width="4" height="16" rx="1" />
            <Rect x="14" y="4" width="4" height="16" rx="1" />
        </Svg>
    );
}

export function SkipNextIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <Polygon points="5 4 15 12 5 20 5 4" />
            <Rect x="17" y="4" width="2.5" height="16" rx="1" />
        </Svg>
    );
}

export function SkipPrevIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <Polygon points="19 20 9 12 19 4 19 20" />
            <Rect x="4.5" y="4" width="2.5" height="16" rx="1" />
        </Svg>
    );
}

export function ShuffleIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M16 3h5v5" />
            <Path d="M4 20L21 3" />
            <Path d="M21 16v5h-5" />
            <Path d="M15 15l6 6" />
            <Path d="M4 4l5 5" />
        </Svg>
    );
}

export function RepeatIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="m17 2 4 4-4 4" />
            <Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <Path d="m7 22-4-4 4-4" />
            <Path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </Svg>
    );
}

export function HeartIcon({ size = 20, color = "#ffffff", filled = false }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : "none"} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </Svg>
    );
}

export function HomeIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <Polyline points="9 22 9 12 15 12 15 22" />
        </Svg>
    );
}

export function SearchIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="11" cy="11" r="8" />
            <Line x1="21" y1="21" x2="16.65" y2="16.65" />
        </Svg>
    );
}

export function LibraryIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
            <Path d="M6 6h10" />
            <Path d="M6 10h10" />
        </Svg>
    );
}

export function VolumeIcon({ size = 20, color = "#ffffff", isMuted = false }: IconProps)
{
    if (isMuted)
    {
        return (
            <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <Line x1="23" y1="9" x2="17" y2="15" />
                <Line x1="17" y1="9" x2="23" y2="15" />
            </Svg>
        );
    }

    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </Svg>
    );
}

export function QueueIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Line x1="8" y1="6" x2="21" y2="6" />
            <Line x1="8" y1="12" x2="21" y2="12" />
            <Line x1="8" y1="18" x2="21" y2="18" />
            <Line x1="3" y1="6" x2="3.01" y2="6" />
            <Line x1="3" y1="12" x2="3.01" y2="12" />
            <Line x1="3" y1="18" x2="3.01" y2="18" />
        </Svg>
    );
}

export function CloseIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Line x1="18" y1="6" x2="6" y2="18" />
            <Line x1="6" y1="6" x2="18" y2="18" />
        </Svg>
    );
}

export function ChevronDownIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Polyline points="6 9 12 15 18 9" />
        </Svg>
    );
}

export function ChevronLeftIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Polyline points="15 18 9 12 15 6" />
        </Svg>
    );
}

export function TrashIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Polyline points="3 6 5 6 21 6" />
            <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </Svg>
    );
}

export function PlusIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Line x1="12" y1="5" x2="12" y2="19" />
            <Line x1="5" y1="12" x2="19" y2="12" />
        </Svg>
    );
}

export function ClockIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="10" />
            <Polyline points="12 6 12 12 16 14" />
        </Svg>
    );
}

export function DiscIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="10" />
            <Circle cx="12" cy="12" r="3" />
        </Svg>
    );
}

export function MusicIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M9 18V5l12-2v13" />
            <Circle cx="6" cy="18" r="3" />
            <Circle cx="18" cy="16" r="3" />
        </Svg>
    );
}

export function RetryIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <Path d="M3 3v5h5" />
        </Svg>
    );
}

export function SpinnerIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="4" opacity={0.25} />
            <Path d="M4 12a8 8 0 018-8" stroke={color} strokeWidth="4" strokeLinecap="round" />
        </Svg>
    );
}

export function LyricsIcon({ size = 20, color = "#ffffff" }: IconProps)
{
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M16 5H3" />
            <Path d="M11 12H3" />
            <Path d="M11 19H3" />
            <Path d="M21 5v12" />
            <Circle cx="18" cy="17" r="3" />
        </Svg>
    );
}

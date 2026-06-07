// ─── Supabase ───────────────────────────────────────────────────────────────
export const SUPABASE_URL  = 'https://fjcmyylspmaqrbfwdzjz.supabase.co';   // 예: 'https://xxxxxxxx.supabase.co'
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqY215eWxzcG1hcXJiZndkemp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzMyMzAsImV4cCI6MjA5MzA0OTIzMH0.XwHbUBmmN-i6DRwfnRJcaVL06OJrFwCk5aZAVCoHQtM';   // Supabase anon public key

// ─── Continue (시간 추가) ───
export const CONTINUE_EXTRA_SECONDS = 30;          // continue 1회당 추가 시간 (초)
export const CONTINUE_PRICES = [800, 1800, 2800];   // 회차별 가격 (1회, 2회, 3회+)

// ─── Ice Item (시간 동결) ───
export const ICE_FREEZE_SECONDS = 20;              // 아이템 사용 시 동결 시간 (초)

// ─── Visual Constants ───
export const BG_COLOR = '#1e293b';
export const CELL_BG = '#0f172a';
// These are kept as reference ratios; actual values are computed from cell size in renderer.js
// dotRadius = cell * 0.38, pathWidth = cell * 0.31, gap = cell * 0.07, cellRadius = cell * 0.11
export const PAD = 20;

// ─── Game Colors (keep in sync with src/js/data/colors.js for level-editor) ───
export const COLORS = [
  { name: 'Red',     nameKo: '빨강',   hex: '#ff0000' },
  { name: 'Orange',  nameKo: '주황',   hex: '#ff8c00' },
  { name: 'Yellow',  nameKo: '노랑',   hex: '#facc15' },
  { name: 'Green',   nameKo: '초록',   hex: '#16a34a' },
  { name: 'Blue',    nameKo: '파랑',   hex: '#2563eb' },
  { name: 'Purple',  nameKo: '보라',   hex: '#7c3aed' },
  { name: 'Pink',    nameKo: '분홍',   hex: '#ec4899' },
  { name: 'Cyan',    nameKo: '하늘',   hex: '#06b6d4' },
  { name: 'Lime',    nameKo: '연두',   hex: '#a3e635' },
  { name: 'Navy',    nameKo: '남색',   hex: '#4a90d9' },
  { name: 'Brown',   nameKo: '갈색',   hex: '#92400e' },
  { name: 'Magenta', nameKo: '마젠타', hex: '#d946ef' },
  { name: 'Teal',     nameKo: '청록',   hex: '#0d9488' },
  { name: 'White',    nameKo: '흰색',   hex: '#e2e8f0' },
  { name: 'Lavender', nameKo: '라벤더', hex: '#a78bfa' },
  { name: 'Mint',     nameKo: '민트',   hex: '#34d399' },
  { name: 'Rose',     nameKo: '로즈',   hex: '#fb7185' },
  { name: 'Amber',    nameKo: '호박',   hex: '#fbbf24' },
  { name: 'Indigo',   nameKo: '인디고', hex: '#4338ca' },
  { name: 'Slate',    nameKo: '슬레이트', hex: '#94a3b8' },
];

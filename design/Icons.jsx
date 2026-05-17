// Lucide-style outline icons, 1.75px stroke, 24x24 base.
// Pass size + className. Stroke = currentColor.

const Icon = ({ size = 18, stroke = 1.75, children, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    {children}
  </svg>
);

const Bug = (p) => <Icon {...p}><path d="M8 2l1.5 1.5M16 2l-1.5 1.5"/><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 6v14M4 12h4M16 12h4M5 6l3 2M19 6l-3 2M5 18l3-2M19 18l-3-2"/></Icon>;
const Sparkles = (p) => <Icon {...p}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9L19 14z"/></Icon>;
const Help = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7v.5"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></Icon>;
const Card = (p) => <Icon {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h3"/></Icon>;
const Folder = (p) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></Icon>;

const Check = (p) => <Icon {...p}><path d="M5 12l5 5L20 7"/></Icon>;
const X = (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>;
const Plus = (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>;
const Search = (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></Icon>;
const Chevron = (p) => <Icon {...p}><path d="M6 9l6 6 6-6"/></Icon>;
const ChevronRight = (p) => <Icon {...p}><path d="M9 6l6 6-6 6"/></Icon>;
const Bell = (p) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9zM10 21a2 2 0 0 0 4 0"/></Icon>;
const Paperclip = (p) => <Icon {...p}><path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 1 1-3-3l7.5-7.5"/></Icon>;
const Link = (p) => <Icon {...p}><path d="M10 14a4 4 0 0 1 0-5.7l3-3a4 4 0 0 1 5.7 5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 1 0 5.7l-3 3a4 4 0 0 1-5.7-5.7l1.5-1.5"/></Icon>;
const Upload = (p) => <Icon {...p}><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 3v13M7 8l5-5 5 5"/></Icon>;
const Send = (p) => <Icon {...p}><path d="M3 11l18-8-8 18-2-8-8-2z"/></Icon>;
const Github = (p) => <Icon {...p}><path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.8-2.2c2.8-.3 5.8-1.4 5.8-6.2a4.7 4.7 0 0 0-1.3-3.3 4.3 4.3 0 0 0-.1-3.3s-1.1-.3-3.6 1.3a12.4 12.4 0 0 0-6.5 0C5.9 1.7 4.8 2 4.8 2a4.3 4.3 0 0 0-.1 3.3A4.7 4.7 0 0 0 3.4 8.6c0 4.7 3 5.9 5.7 6.2A3 3 0 0 0 8.3 17V21"/></Icon>;
const Mail = (p) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></Icon>;
const Inbox = (p) => <Icon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-7z"/></Icon>;
const User = (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Icon>;
const Users = (p) => <Icon {...p}><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="7" r="3"/><path d="M22 19a5 5 0 0 0-6-5"/></Icon>;
const Settings = (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></Icon>;
const Tag = (p) => <Icon {...p}><path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/></Icon>;
const Flag = (p) => <Icon {...p}><path d="M4 21V4M4 4h13l-2 4 2 4H4"/></Icon>;
const Lock = (p) => <Icon {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></Icon>;
const Eye = (p) => <Icon {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></Icon>;
const Filter = (p) => <Icon {...p}><path d="M3 5h18l-7 9v6l-4-2v-4L3 5z"/></Icon>;
const Sort = (p) => <Icon {...p}><path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/></Icon>;
const Dots = (p) => <Icon {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></Icon>;
const Globe = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></Icon>;
const Palette = (p) => <Icon {...p}><path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.7 4-5 4h-2a2 2 0 0 0-1 3.7A2 2 0 0 1 12 22z"/><circle cx="7" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="11" r="1" fill="currentColor" stroke="none"/></Icon>;
const Copy = (p) => <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></Icon>;
const Bold = (p) => <Icon {...p}><path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"/></Icon>;
const Italic = (p) => <Icon {...p}><path d="M14 4h-4M10 20h4M15 4L9 20"/></Icon>;
const Code = (p) => <Icon {...p}><path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></Icon>;
const Quote = (p) => <Icon {...p}><path d="M3 8h4v4H3zM3 12c0 3 1 5 4 6M13 8h4v4h-4zM13 12c0 3 1 5 4 6"/></Icon>;
const ListIcon = (p) => <Icon {...p}><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/></Icon>;
const Heading = (p) => <Icon {...p}><path d="M6 4v16M18 4v16M6 12h12"/></Icon>;
const Arrow = (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>;
const ArrowLeft = (p) => <Icon {...p}><path d="M19 12H5M11 18l-6-6 6-6"/></Icon>;
const Trash = (p) => <Icon {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></Icon>;
const Edit = (p) => <Icon {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></Icon>;
const Clock = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>;
const Star = (p) => <Icon {...p}><path d="M12 3l2.7 5.6 6.3.9-4.5 4.3 1 6.2-5.5-2.9L6.5 20l1-6.2L3 9.5l6.3-.9L12 3z"/></Icon>;
const Logo = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
    <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/>
    <path d="M7 8h10M7 12h7M7 16h5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

Object.assign(window, {
  Bug, Sparkles, Help, Card, Folder,
  Check, X, Plus, Search, Chevron, ChevronRight, Bell, Paperclip, Link, Upload, Send,
  Github, Mail, Inbox, User, Users, Settings, Tag, Flag, Lock, Eye, Filter, Sort,
  Dots, Globe, Palette, Copy, Bold, Italic, Code, Quote, ListIcon, Heading,
  Arrow, ArrowLeft, Trash, Edit, Clock, Star, Logo,
});

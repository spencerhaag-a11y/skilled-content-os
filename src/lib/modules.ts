import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Palette,
  BookOpen,
  Recycle,
  Share2,
  FileText,
  Mail,
  Quote,
  Video,
  Kanban,
  CalendarDays,
  Library,
  MessagesSquare,
  Sparkles,
  Search,
  MapPin,
  Globe,
  Radio,
  Compass,
  BarChart3,
  Settings,
} from "lucide-react";

export interface ModuleDef {
  /** Route path under the authenticated app shell */
  path: string;
  /** Sidebar + page title */
  name: string;
  /** One-line purpose shown on the module page until its phase ships */
  description: string;
  icon: LucideIcon;
  /** Build phase from Section 4 of the spec; 0 = live now */
  phase: number;
  /** Sidebar grouping */
  group: "Overview" | "Create" | "Pipeline" | "Intelligence" | "Setup";
}

/**
 * Single source of truth for the 20 client-facing modules (Section 2).
 * Sidebar navigation and React Router routes are both generated from this
 * registry, so adding a module in a later phase is a one-line change here
 * plus its page implementation.
 */
export const MODULES: ModuleDef[] = [
  { path: "/", name: "Dashboard", description: "Metrics, setup progress, and recent content at a glance.", icon: LayoutDashboard, phase: 4, group: "Overview" },
  { path: "/analytics", name: "Analytics", description: "Content volume, pipeline status, module usage, and GHL push history.", icon: BarChart3, phase: 22, group: "Overview" },

  { path: "/repurpose", name: "Repurposing Engine", description: "One input in — a full multi-platform content suite out.", icon: Recycle, phase: 5, group: "Create" },
  { path: "/social-posts", name: "Social Posts", description: "Platform-specific posts built from your brand kit and knowledge base.", icon: Share2, phase: 6, group: "Create" },
  { path: "/blog-posts", name: "Blog Posts", description: "Long-form SEO content aligned to your pillars and voice.", icon: FileText, phase: 7, group: "Create" },
  { path: "/email", name: "Email Marketing", description: "Newsletters, promos, and drip sequences — pushed straight to GHL.", icon: Mail, phase: 8, group: "Create" },
  { path: "/testimonials", name: "Testimonials", description: "Collect client reviews and turn them into polished social proof.", icon: Quote, phase: 9, group: "Create" },
  { path: "/video", name: "Video", description: "Upload footage for transcripts, edit markers, captions, and clips.", icon: Video, phase: 16, group: "Create" },
  { path: "/brainstorm", name: "Brainstorm Chat", description: "A conversational AI that knows your entire business.", icon: MessagesSquare, phase: 13, group: "Create" },

  { path: "/kanban", name: "Approval Board", description: "Drag content from draft to published — approvals trigger GHL push.", icon: Kanban, phase: 10, group: "Pipeline" },
  { path: "/calendar", name: "Calendar", description: "Month and week views of everything scheduled.", icon: CalendarDays, phase: 11, group: "Pipeline" },
  { path: "/library", name: "Content Library", description: "Every piece of content you've created — searchable and filterable.", icon: Library, phase: 12, group: "Pipeline" },
  { path: "/prompts", name: "Prompt Library", description: "Saved prompts that get smarter with trends and performance data.", icon: Sparkles, phase: 14, group: "Pipeline" },

  { path: "/seo", name: "SEO Tools", description: "Keyword research, content gaps, and on-page scoring.", icon: Search, phase: 17, group: "Intelligence" },
  { path: "/google-business", name: "Google Business", description: "GBP audits, posts, review responses, and local keywords.", icon: MapPin, phase: 18, group: "Intelligence" },
  { path: "/website-scanner", name: "Website Scanner", description: "Scan any URL for brand signals, gaps, and competitor positioning.", icon: Globe, phase: 19, group: "Intelligence" },
  { path: "/social-listener", name: "Social Listener", description: "Analyze any social account's tone, formats, and posting patterns.", icon: Radio, phase: 20, group: "Intelligence" },
  { path: "/niche-research", name: "Niche Research", description: "Trending topics, FAQs, and seasonal opportunities in your niche.", icon: Compass, phase: 21, group: "Intelligence" },

  { path: "/brand-kit", name: "Brand Kit", description: "The foundation every piece of AI content pulls from.", icon: Palette, phase: 2, group: "Setup" },
  { path: "/knowledge-base", name: "Knowledge Base", description: "Your documents, assets, and business facts — AI context for everything.", icon: BookOpen, phase: 3, group: "Setup" },
  { path: "/settings", name: "Settings", description: "Account, branding, and GHL connection.", icon: Settings, phase: 15, group: "Setup" },
];

export const MODULE_GROUPS: ModuleDef["group"][] = [
  "Overview",
  "Create",
  "Pipeline",
  "Intelligence",
  "Setup",
];

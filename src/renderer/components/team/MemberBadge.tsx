import { inferMascotRole, Mascot } from '@renderer/components/aurora/Mascot';
import {
  getTeamColorSet,
  getThemedBadge,
  getThemedBorder,
  getThemedText,
} from '@renderer/constants/teamColors';
import { useTheme } from '@renderer/hooks/useTheme';
import { useStore } from '@renderer/store';
import { displayMemberName } from '@renderer/utils/memberHelpers';

import { MemberHoverCard } from './members/MemberHoverCard';

interface MemberBadgeProps {
  name: string;
  color?: string;
  /** Owning team context for hover-card store lookups. */
  teamName?: string;
  /** Avatar + badge size variant */
  size?: 'xs' | 'sm' | 'md';
  /** Hide the avatar icon, show only the name badge */
  hideAvatar?: boolean;
  onClick?: (name: string) => void;
  /** Disable the hover card (e.g. inside MemberHoverCard itself to avoid nesting) */
  disableHoverCard?: boolean;
}

/**
 * Reusable member avatar + colored name badge.
 * Avatar is rendered OUTSIDE the badge, to the left.
 * When onClick is provided, both avatar and badge are clickable as one unit.
 * Wrapped in MemberHoverCard to show member info on hover.
 */
export const MemberBadge = ({
  name,
  color,
  teamName,
  size = 'sm',
  hideAvatar,
  onClick,
  disableHoverCard,
}: MemberBadgeProps): React.JSX.Element => {
  const colors = getTeamColorSet(color ?? '');
  const { isLight } = useTheme();
  // Resolve the member's role from the active team so the mascot
  // identity matches the kanban / roster — ink-2's brown
  // agentAvatarUrl figure used to produce a different character per
  // surface. Falls back to "coder" when the member can't be located.
  const member = useStore((s) => s.selectedTeamData?.members.find((m) => m.name === name));
  const mascotRole = inferMascotRole(member?.role ?? member?.agentType ?? null);
  // Mascot only accepts 24|32|48|64|96|128 — pick the closest match.
  const mascotSize: 24 | 32 = size === 'md' ? 32 : 24;
  const textClass = size === 'md' ? 'text-xs' : size === 'sm' ? 'text-[10px]' : 'text-[9px]';
  const paddingClass = size === 'xs' ? 'px-1 py-0.5' : 'px-1.5 py-0.5';

  const badgeStyle = {
    backgroundColor: getThemedBadge(colors, isLight),
    color: getThemedText(colors, isLight),
    border: `1px solid ${getThemedBorder(colors, isLight)}40`,
  };

  const avatar = (
    <Mascot
      role={mascotRole}
      size={mascotSize}
      seed={name}
      ariaLabel={`${displayMemberName(name)} mascot`}
    />
  );

  const badge = (
    <span
      className={`rounded ${paddingClass} ${textClass} font-medium tracking-wide`}
      style={badgeStyle}
    >
      {displayMemberName(name)}
    </span>
  );

  // Skip hover card for "user" and "system" pseudo-members
  const skipHoverCard = disableHoverCard || name === 'user' || name === 'system';

  const content = onClick ? (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded transition-opacity hover:opacity-90 focus:outline-none focus:ring-1 focus:ring-[var(--color-border)]"
      onClick={(e) => {
        e.stopPropagation();
        onClick(name);
      }}
    >
      {!hideAvatar && avatar}
      {badge}
    </button>
  ) : (
    <span className="inline-flex items-center gap-1">
      {!hideAvatar && avatar}
      {badge}
    </span>
  );

  if (skipHoverCard) {
    return content;
  }

  return (
    <MemberHoverCard name={name} color={color} teamName={teamName}>
      {content}
    </MemberHoverCard>
  );
};

/**
 * MoreMenu - Dropdown menu behind a "..." icon for less-frequent toolbar actions.
 *
 * Groups: Teams, Settings, Search.
 * Closes on outside click or Escape.
 */

import React, { useEffect, useRef, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { MoreHorizontal, Search, Settings, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onClick: () => void;
}

export const MoreMenu = (): React.JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const [buttonHover, setButtonHover] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { openCommandPalette, openSettingsTab, openTeamsTab } = useStore(
    useShallow((s) => ({
      openCommandPalette: () => s.openCommandPalette(),
      openSettingsTab: () => s.openSettingsTab(),
      openTeamsTab: () => s.openTeamsTab(),
    }))
  );

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Build menu items
  const menuItems: MenuItem[] = [
    {
      id: 'teams',
      label: 'Teams',
      icon: Users,
      onClick: () => {
        openTeamsTab();
        setIsOpen(false);
      },
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      onClick: () => {
        openSettingsTab();
        setIsOpen(false);
      },
    },
    {
      id: 'search',
      label: 'Search',
      icon: Search,
      shortcut: formatShortcut('K'),
      onClick: () => {
        openCommandPalette();
        setIsOpen(false);
      },
    },
  ];

  const renderItem = (item: MenuItem): React.JSX.Element => (
    <button
      key={item.id}
      onClick={item.onClick}
      onMouseEnter={() => setHoveredId(item.id)}
      onMouseLeave={() => setHoveredId(null)}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors"
      style={{
        color: hoveredId === item.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
        backgroundColor: hoveredId === item.id ? 'var(--color-surface-raised)' : 'transparent',
      }}
    >
      <item.icon className="size-3.5" />
      <span className="flex-1">{item.label}</span>
      {item.shortcut && (
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {item.shortcut}
        </span>
      )}
    </button>
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsOpen(!isOpen)}
            onMouseEnter={() => setButtonHover(true)}
            onMouseLeave={() => setButtonHover(false)}
            className="rounded-md p-2 transition-colors"
            style={{
              color: buttonHover || isOpen ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor:
                buttonHover || isOpen ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="More actions"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">More actions</TooltipContent>
      </Tooltip>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border py-1 shadow-lg"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            borderColor: 'var(--color-border)',
          }}
        >
          {menuItems.map(renderItem)}
        </div>
      )}
    </div>
  );
};

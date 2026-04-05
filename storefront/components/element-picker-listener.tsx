'use client';

import { useEffect } from 'react';

/**
 * Element picker listener for admin element selection
 *
 * Listens for postMessage from parent (admin dashboard) to activate element picker mode.
 * When activated, highlights elements on hover and sends selected element data back.
 */
export function ElementPickerListener() {
  useEffect(() => {
    // Send navigation updates to parent on route changes
    if (window.parent !== window) {
      const sendNavigationUpdate = () => {
        const path = window.location.pathname + window.location.search;
        window.parent.postMessage({
          type: 'NAVIGATION_CHANGE',
          path,
        }, '*');
      };

      // Send initial path
      sendNavigationUpdate();

      // Listen for popstate (back/forward)
      window.addEventListener('popstate', sendNavigationUpdate);

      // Intercept link clicks for Next.js navigation
      const handleClick = () => {
        setTimeout(sendNavigationUpdate, 100);
      };
      document.addEventListener('click', handleClick);

      return () => {
        window.removeEventListener('popstate', sendNavigationUpdate);
        document.removeEventListener('click', handleClick);
      };
    }
  }, []);

  useEffect(() => {
    let isActive = false;
    let overlay: HTMLDivElement | null = null;
    let tooltip: HTMLDivElement | null = null;
    let currentElement: Element | null = null;

    // Generate CSS selector for element
    function getSelector(el: Element): string {
      if (el.id) return `#${el.id}`;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.split(' ').filter((c) => c.trim()).join('.');
        if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
      }
      return el.tagName.toLowerCase();
    }

    // Get element data
    function getElementData(el: Element) {
      const text = el.textContent?.trim().substring(0, 50) || '';
      return {
        tag: el.tagName.toLowerCase(),
        classes: Array.from(el.classList),
        id: (el as HTMLElement).id || undefined,
        text: text || undefined,
        selector: getSelector(el),
      };
    }

    // Highlight element
    function highlightElement(el: Element) {
      if (!el || el === document.body || el === document.documentElement || !overlay || !tooltip) return;

      const rect = el.getBoundingClientRect();
      overlay.style.cssText = `
        position: fixed;
        border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.1);
        pointer-events: none;
        z-index: 999999;
        transition: all 0.1s ease;
        box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
      `;

      // Show tooltip with "Click to select" message
      tooltip.textContent = 'Click to select';
      tooltip.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        z-index: 1000000;
        white-space: nowrap;
        opacity: 1;
        top: ${rect.top - 28}px;
        left: ${rect.left}px;
      `;
    }

    // Mouse move handler
    function handleMouseMove(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();

      const el = e.target as Element;
      if (el === overlay || el === tooltip) return;

      currentElement = el;
      highlightElement(el);
    }

    // Click handler
    function handleClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (!currentElement) return;

      const data = getElementData(currentElement);

      // Send to parent
      window.parent.postMessage(
        {
          type: 'ELEMENT_PICKED',
          data,
        },
        '*'
      );

      // Cleanup
      cleanup();
    }

    // ESC key handler
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        window.parent.postMessage({ type: 'ELEMENT_PICKER_CANCELLED' }, '*');
        cleanup();
      }
    }

    // Cleanup function
    function cleanup() {
      isActive = false;
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      overlay?.remove();
      tooltip?.remove();
      overlay = null;
      tooltip = null;
      document.body.style.cursor = '';
    }

    // Activate picker
    function activate() {
      if (isActive) return;
      isActive = true;

      // Create overlay
      overlay = document.createElement('div');
      document.body.appendChild(overlay);

      // Create tooltip
      tooltip = document.createElement('div');
      document.body.appendChild(tooltip);

      // Add listeners
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);

      // Change cursor
      document.body.style.cursor = 'crosshair';

      // Notify parent that picker is active
      window.parent.postMessage({ type: 'ELEMENT_PICKER_READY' }, '*');
    }

    // Listen for messages from parent
    function handleMessage(event: MessageEvent) {
      // Only accept messages from parent
      if (event.source !== window.parent) return;

      if (event.data.type === 'ACTIVATE_ELEMENT_PICKER') {
        activate();
      } else if (event.data.type === 'DEACTIVATE_ELEMENT_PICKER') {
        cleanup();
      }
    }

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
      cleanup();
    };
  }, []);

  return null;
}

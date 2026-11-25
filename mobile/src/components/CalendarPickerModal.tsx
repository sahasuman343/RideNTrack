import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRideTheme, RidePalette } from '../theme';
import { Icon } from './ui/Icon';

export interface CalendarPickerModalProps {
  visible: boolean;
  onClose: () => void;
  startDate?: string;
  endDate?: string;
  onSelectRange: (start: string, end: string) => void;
  title?: string;
}

export function formatYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateNice(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getUTCDay()]}, ${months[m - 1]} ${d}, ${y}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function CalendarPickerModal({
  visible,
  onClose,
  startDate = '',
  endDate = '',
  onSelectRange,
  title = 'Select trip dates',
}: CalendarPickerModalProps) {
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  const [selStart, setSelStart] = useState<string>('');
  const [selEnd, setSelEnd] = useState<string>('');

  useEffect(() => {
    if (visible) {
      setSelStart(startDate);
      setSelEnd(endDate);
      if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        const [y, m, d] = startDate.split('-').map(Number);
        setViewDate(new Date(y, m - 1, d));
      } else {
        setViewDate(new Date());
      }
    }
  }, [visible, startDate, endDate]);

  const todayStr = useMemo(() => formatYMD(new Date()), []);

  const currentYear = viewDate.getFullYear();
  const currentMonth = viewDate.getMonth();

  function prevMonth() {
    setViewDate(new Date(currentYear, currentMonth - 1, 1));
  }

  function nextMonth() {
    setViewDate(new Date(currentYear, currentMonth + 1, 1));
  }

  // Quick Preset Handlers
  function applyPreset(start: Date, end: Date) {
    const sStr = formatYMD(start);
    const eStr = formatYMD(end);
    setSelStart(sStr);
    setSelEnd(eStr);
    setViewDate(new Date(start.getFullYear(), start.getMonth(), 1));
  }

  function presetToday() {
    const now = new Date();
    applyPreset(now, now);
  }

  function presetTomorrow() {
    const tom = new Date();
    tom.setDate(tom.getDate() + 1);
    applyPreset(tom, tom);
  }

  function presetThisWeekend() {
    const now = new Date();
    const day = now.getDay(); // 0 is Sunday, 6 is Saturday
    const sat = new Date(now);
    if (day === 6) {
      // Today is Saturday
    } else if (day === 0) {
      // Today is Sunday, ride starts today
    } else {
      sat.setDate(now.getDate() + (6 - day));
    }
    const sun = new Date(sat);
    if (day !== 0) {
      sun.setDate(sat.getDate() + 1);
    }
    applyPreset(sat, sun);
  }

  function presetNextWeekend() {
    const now = new Date();
    const day = now.getDay();
    const daysUntilNextSat = (6 - day + 7) % 7 || 7;
    const sat = new Date(now);
    sat.setDate(now.getDate() + daysUntilNextSat);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    applyPreset(sat, sun);
  }

  function handleDayTap(dateStr: string) {
    if (dateStr < todayStr) return; // Cannot select past dates

    if (!selStart || (selStart && selEnd)) {
      setSelStart(dateStr);
      setSelEnd('');
    } else if (selStart && !selEnd) {
      if (dateStr < selStart) {
        setSelStart(dateStr);
        setSelEnd('');
      } else {
        setSelEnd(dateStr);
      }
    }
  }

  function handleConfirm() {
    if (!selStart) return;
    const finalEnd = selEnd || selStart;
    onSelectRange(selStart, finalEnd);
    onClose();
  }

  function handleClear() {
    setSelStart('');
    setSelEnd('');
  }

  // Build Calendar grid
  const daysGrid = useMemo(() => {
    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const cells: Array<{
      key: string;
      empty: boolean;
      dayNumber?: number;
      dateStr?: string;
      isPast?: boolean;
      isStart?: boolean;
      isEnd?: boolean;
      isInRange?: boolean;
      isToday?: boolean;
    }> = [];

    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push({ key: `blank-${i}`, empty: true });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatYMD(new Date(currentYear, currentMonth, d));
      const isPast = dateStr < todayStr;
      const isStart = dateStr === selStart;
      const isEnd = dateStr === selEnd;
      const isInRange = Boolean(selStart && selEnd && dateStr > selStart && dateStr < selEnd);
      const isToday = dateStr === todayStr;

      cells.push({
        key: dateStr,
        empty: false,
        dayNumber: d,
        dateStr,
        isPast,
        isStart,
        isEnd,
        isInRange,
        isToday,
      });
    }

    return cells;
  }, [currentYear, currentMonth, todayStr, selStart, selEnd]);

  // Days Count Calculation
  const daysCount = useMemo(() => {
    if (!selStart) return 0;
    if (!selEnd) return 1;
    const s = new Date(selStart).getTime();
    const e = new Date(selEnd).getTime();
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
  }, [selStart, selEnd]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>MOTORCYCLE TOUR DATES</Text>
              <Text style={styles.title}>{title}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close calendar">
              <Icon name="close" size="md" color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Quick Presets */}
          <View style={styles.presetsRow}>
            <TouchableOpacity style={styles.presetChip} onPress={presetToday}>
              <Text style={styles.presetText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetChip} onPress={presetTomorrow}>
              <Text style={styles.presetText}>Tomorrow</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetChip} onPress={presetThisWeekend}>
              <Text style={styles.presetText}>This Weekend</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetChip} onPress={presetNextWeekend}>
              <Text style={styles.presetText}>Next Weekend</Text>
            </TouchableOpacity>
          </View>

          {/* Month Navigator */}
          <View style={styles.monthNav}>
            <TouchableOpacity style={styles.navBtn} onPress={prevMonth} accessibilityRole="button" accessibilityLabel="Previous month">
              <Text style={styles.navArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthLabel}>
              {MONTH_NAMES[currentMonth]} {currentYear}
            </Text>
            <TouchableOpacity style={styles.navBtn} onPress={nextMonth} accessibilityRole="button" accessibilityLabel="Next month">
              <Text style={styles.navArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Day of Week Labels */}
          <View style={styles.weekLabelsRow}>
            {DAY_LABELS.map((label, idx) => (
              <Text key={idx} style={styles.weekDayLabel}>
                {label}
              </Text>
            ))}
          </View>

          {/* Calendar Day Grid */}
          <View style={styles.grid}>
            {daysGrid.map((item) => {
              if (item.empty) {
                return <View key={item.key} style={styles.emptyCell} />;
              }

              const isEndpoint = item.isStart || item.isEnd;

              return (
                <TouchableOpacity
                  key={item.key}
                  disabled={item.isPast}
                  onPress={() => item.dateStr && handleDayTap(item.dateStr)}
                  style={[
                    styles.dayCell,
                    item.isInRange && styles.dayInRange,
                    isEndpoint && styles.dayEndpoint,
                    item.isPast && styles.dayPast,
                    item.isToday && !isEndpoint && styles.dayTodayBorder,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={item.dateStr}
                >
                  <Text
                    style={[
                      styles.dayText,
                      item.isPast && styles.dayTextPast,
                      isEndpoint && styles.dayTextEndpoint,
                      item.isInRange && styles.dayTextInRange,
                      item.isToday && !isEndpoint && styles.dayTextToday,
                    ]}
                  >
                    {item.dayNumber}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selection Summary */}
          <View style={styles.summaryBar}>
            {selStart ? (
              <View style={styles.summaryRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="calendar-outline" size="xs" color={theme.textMuted} />
                  <Text style={styles.summaryDates}>
                    {formatDateNice(selStart)}
                    {selEnd && selEnd !== selStart ? ` → ${formatDateNice(selEnd)}` : ''}
                  </Text>
                </View>
                <Text style={styles.summaryBadge}>
                  {daysCount} {daysCount === 1 ? 'Day' : 'Days'}
                </Text>
              </View>
            ) : (
              <Text style={styles.summaryHint}>
                Tap a start date, then tap an end date (or 1 tap for single-day)
              </Text>
            )}
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.clearBtn} onPress={handleClear} disabled={!selStart}>
              <Text style={[styles.clearBtnText, !selStart && { opacity: 0.4 }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, !selStart && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!selStart}
            >
              <Text style={styles.confirmBtnText}>Apply Dates</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    dialog: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 14,
      width: '100%',
      maxWidth: 380,
      padding: 18,
      gap: 12,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    eyebrow: {
      color: c.accent,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.5,
    },
    title: {
      color: c.text,
      fontSize: 20,
      fontWeight: '900',
      marginTop: 2,
    },
    closeBtn: {
      padding: 6,
    },
    closeText: {
      color: c.muted,
      fontSize: 18,
      fontWeight: '700',
    },
    presetsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingVertical: 4,
    },
    presetChip: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    presetText: {
      color: c.text,
      fontSize: 11,
      fontWeight: '700',
    },
    monthNav: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
      borderTopWidth: 1,
      borderTopColor: c.border,
      marginTop: 2,
    },
    monthLabel: {
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
    },
    navBtn: {
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    navArrow: {
      color: c.accent,
      fontSize: 22,
      fontWeight: '900',
    },
    weekLabelsRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingBottom: 4,
    },
    weekDayLabel: {
      width: 40,
      textAlign: 'center',
      color: c.muted,
      fontSize: 11,
      fontWeight: '800',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-around',
    },
    emptyCell: {
      width: 40,
      height: 38,
      marginVertical: 2,
    },
    dayCell: {
      width: 40,
      height: 38,
      justifyContent: 'center',
      alignItems: 'center',
      marginVertical: 2,
      borderRadius: 19,
    },
    dayPast: {
      opacity: 0.25,
    },
    dayEndpoint: {
      backgroundColor: c.accent,
    },
    dayInRange: {
      backgroundColor: c.accentSoft,
      borderRadius: 0,
    },
    dayTodayBorder: {
      borderWidth: 1.5,
      borderColor: c.accent,
    },
    dayText: {
      color: c.text,
      fontSize: 13,
      fontWeight: '700',
    },
    dayTextPast: {
      color: c.muted,
    },
    dayTextEndpoint: {
      color: '#FFFFFF',
      fontWeight: '900',
    },
    dayTextInRange: {
      color: c.accent,
      fontWeight: '800',
    },
    dayTextToday: {
      color: c.accent,
      fontWeight: '900',
    },
    summaryBar: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      marginTop: 4,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
    },
    summaryDates: {
      color: c.text,
      fontSize: 12,
      fontWeight: '800',
      flex: 1,
    },
    summaryBadge: {
      backgroundColor: c.accent,
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '900',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 6,
    },
    summaryHint: {
      color: c.muted,
      fontSize: 11,
      lineHeight: 16,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 10,
      marginTop: 4,
    },
    clearBtn: {
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    clearBtnText: {
      color: c.danger,
      fontSize: 13,
      fontWeight: '700',
    },
    confirmBtn: {
      backgroundColor: c.accent,
      paddingVertical: 10,
      paddingHorizontal: 18,
      borderRadius: 8,
    },
    confirmBtnDisabled: {
      opacity: 0.5,
    },
    confirmBtnText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '800',
    },
  });

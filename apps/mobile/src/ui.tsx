import { type ReactNode, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useNav } from './lib/nav';

/** Large, touch-friendly building blocks with plain language (PRD §21.5, §25.4). */
/** Teal and white theme. Change the brand colour here only. */
export const colors = {
  bg: '#f3faf9',
  surface: '#ffffff',
  border: '#cfe5e1',
  text: '#0f2a2c',
  muted: '#55707a',
  primary: '#0f766e',
  primaryDark: '#115e59',
  primarySoft: '#ccfbf1',
  primaryText: '#ffffff',
  success: '#15803d',
  successBg: '#dcfce7',
  warning: '#b45309',
  warningBg: '#fef3c7',
  danger: '#b91c1c',
  dangerBg: '#fee2e2',
  infoBg: '#ccfbf1',
};

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneColors: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: '#e3f1ee', fg: colors.muted },
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.warningBg, fg: colors.warning },
  danger: { bg: colors.dangerBg, fg: colors.danger },
  info: { bg: colors.infoBg, fg: colors.primary },
};

export function Screen({
  title,
  subtitle,
  children,
  footer,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Stays at the bottom: the primary action of the screen. */
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const nav = useNav();
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {nav.canGoBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={nav.back}
            style={styles.back}
            hitSlop={12}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

/** Teal title bar for full-screen modals, with a close action on the right. */
export function ModalHeader({
  title,
  onClose,
  closeLabel = 'Close',
}: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { flex: 1 }]} accessibilityRole="header">
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        hitSlop={12}
        style={styles.headerAction}
      >
        <Text style={styles.headerActionText}>{closeLabel}</Text>
      </Pressable>
    </View>
  );
}

/** Teal brand band for screens without a navigation header (sign-in, first password). */
export function Hero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroMark}>
        <Text style={styles.heroMarkText}>K</Text>
      </View>
      <Text style={styles.heroTitle} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  big,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
}) {
  const off = disabled || busy;
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.surface
          : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? colors.primaryText : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, big && { fontSize: 18 }, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, tone }: { children: ReactNode; tone?: Tone }) {
  return (
    <View
      style={[
        styles.card,
        tone && tone !== 'neutral' ? { borderColor: toneColors[tone].fg } : null,
      ]}
    >
      {children}
    </View>
  );
}

export function Banner({
  tone = 'danger',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) {
  const c = toneColors[tone];
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: c.bg, borderColor: c.fg }]}
    >
      {title ? <Text style={[styles.bannerTitle, { color: c.fg }]}>{title}</Text> : null}
      {typeof children === 'string' ? <Text style={styles.bannerText}>{children}</Text> : children}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field({
  label,
  hint,
  warn,
  ...props
}: TextInputProps & { label: string; hint?: string; warn?: boolean }) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          styles.input,
          warn && { borderColor: colors.warning, borderWidth: 2 },
          props.editable === false && { opacity: 0.6 },
        ]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** A quantity: numeric keypad, digits and one dot only (quantities are decimal strings). */
export function QuantityField(
  props: Omit<TextInputProps, 'keyboardType'> & { label: string; hint?: string; warn?: boolean },
) {
  return (
    <Field
      {...props}
      keyboardType="decimal-pad"
      onChangeText={(t) =>
        props.onChangeText?.(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))
      }
    />
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.subtitle}>{text}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export interface Option {
  id: string;
  label: string;
  detail?: string;
  /** Shown above the rest, e.g. "Possible matches". */
  group?: string;
}

/**
 * Pick one from a list, with search: minimal typing (PRD §21.5).
 * `onCreate` adds an "add new" row for lists that allow it (contractors).
 */
export function Picker({
  label,
  placeholder = 'Choose…',
  value,
  options,
  onChange,
  onCreate,
  createLabel,
  disabled,
  warn,
}: {
  label: string;
  placeholder?: string;
  value: string | null;
  options: Option[];
  onChange: (id: string) => void;
  onCreate?: (typed: string) => void;
  createLabel?: string;
  disabled?: boolean;
  warn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = options.find((o) => o.id === value);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.detail ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, q]);

  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        disabled={disabled}
        onPress={() => {
          setQ('');
          setOpen(true);
        }}
        style={[
          styles.input,
          styles.pickerButton,
          warn && { borderColor: colors.warning, borderWidth: 2 },
          disabled && { opacity: 0.6 },
        ]}
      >
        <Text style={[styles.pickerText, !selected && { color: colors.muted }]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Text style={{ color: colors.muted }}>▾</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.screen}>
          <ModalHeader title={label} onClose={() => setOpen(false)} />
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            <TextInput
              accessibilityLabel={`Search ${label}`}
              placeholder="Search"
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              autoFocus={options.length > 8}
              style={styles.input}
            />
          </View>
          <FlatList
            data={shown}
            keyExtractor={(o) => o.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={<Empty text="Nothing found." />}
            ListFooterComponent={
              onCreate ? (
                <Button
                  label={
                    q.trim() ? `${createLabel ?? 'Add'} “${q.trim()}”` : (createLabel ?? 'Add new')
                  }
                  variant="secondary"
                  onPress={() => {
                    setOpen(false);
                    onCreate(q.trim());
                  }}
                />
              ) : undefined
            }
            renderItem={({ item, index }) => (
              <>
                {item.group && item.group !== shown[index - 1]?.group ? (
                  <Text style={styles.group}>{item.group}</Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => {
                    setOpen(false);
                    onChange(item.id);
                  }}
                  style={[
                    styles.option,
                    item.id === value && { borderColor: colors.primary, borderWidth: 2 },
                  ]}
                >
                  <Text style={styles.optionText}>{item.label}</Text>
                  {item.detail ? <Text style={styles.hint}>{item.detail}</Text> : null}
                </Pressable>
              </>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

/** A few choices side by side: condition, reason. */
export function Segments<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T | null;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <View style={styles.segments}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={o.label}
              disabled={disabled}
              onPress={() => onChange(o.id)}
              style={[
                styles.segment,
                on && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Text style={[styles.segmentText, on && { color: colors.primaryText }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 16,
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.primaryText },
  headerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  headerAction: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  headerActionText: { fontSize: 15, fontWeight: '700', color: colors.primaryText },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  backText: { fontSize: 30, lineHeight: 32, color: colors.primaryText },
  hero: {
    backgroundColor: colors.primary,
    paddingTop: 72,
    paddingBottom: 32,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroMarkText: { fontSize: 28, fontWeight: '800', color: colors.primary },
  heroTitle: { fontSize: 30, fontWeight: '800', color: colors.primaryText },
  heroSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 2 },
  body: { padding: 16, paddingTop: 20, gap: 12, paddingBottom: 32 },
  footer: {
    padding: 16,
    gap: 8,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  button: {
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBig: { minHeight: 64 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  banner: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  bannerText: { fontSize: 15, color: colors.text },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 },
  field: { gap: 0 },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    fontSize: 17,
    color: colors.text,
  },
  hint: { fontSize: 13, color: colors.muted, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowLabel: { fontSize: 15, color: colors.muted, flexShrink: 0 },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  loading: { padding: 32, alignItems: 'center', gap: 12 },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 15, padding: 20 },
  pickerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontSize: 17, color: colors.text, flex: 1 },
  option: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    minHeight: 52,
  },
  optionText: { fontSize: 17, color: colors.text, fontWeight: '600' },
  group: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 2,
  },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: {
    minHeight: 48,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentText: { fontSize: 15, fontWeight: '600', color: colors.text },
  h2: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 8 },
  text: { fontSize: 15, color: colors.text },
  mono: { fontSize: 15, fontWeight: '700', color: colors.text },
});

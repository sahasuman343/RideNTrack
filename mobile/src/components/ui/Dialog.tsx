import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  AccessibilityInfo,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRideTheme, RidePalette, spacing, radius, typography, elevation } from '../../theme';
import { Button } from './Button';

export interface DialogAction {
  text: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  loading?: boolean;
}

export interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBackgroundColor?: string;
  actions?: DialogAction[];
  onDismiss?: () => void;
  testID?: string;
}

export function Dialog({
  visible,
  title,
  message,
  icon,
  iconColor,
  iconBackgroundColor,
  actions = [],
  onDismiss,
  testID = 'dialog',
}: DialogProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onDismiss} accessible={false}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback accessible={false}>
            <View
              style={styles.dialogCard}
              testID={testID}
              accessible
              accessibilityRole="alert"
              accessibilityLabel={`${title}. ${message || ''}`}
            >
              {icon ? (
                <View
                  style={[
                    styles.iconContainer,
                    iconBackgroundColor ? { backgroundColor: iconBackgroundColor } : null,
                  ]}
                >
                  <Ionicons
                    name={icon}
                    size={28}
                    color={iconColor || theme.accent}
                  />
                </View>
              ) : null}

              <Text style={styles.title}>{title}</Text>

              {message ? <Text style={styles.message}>{message}</Text> : null}

              {actions.length > 0 ? (
                <View
                  style={[
                    styles.actionsContainer,
                    actions.length > 2 ? styles.actionsStacked : null,
                  ]}
                >
                  {actions.map((action, index) => (
                    <View
                      key={index}
                      style={[
                        styles.actionButtonWrapper,
                        actions.length <= 2 ? styles.actionButtonFlex : null,
                      ]}
                    >
                      <Button
                        title={action.text}
                        onPress={action.onPress}
                        variant={action.variant || (index === actions.length - 1 ? 'primary' : 'secondary')}
                        size="md"
                        loading={action.loading}
                      />
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

function makeStyles(c: RidePalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
    },
    dialogCard: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.borderStrong,
      padding: spacing.xl,
      ...elevation('overlay', c),
    },
    iconContainer: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    title: {
      ...typography.headlineMd,
      color: c.text,
      marginBottom: spacing.sm,
    },
    message: {
      ...typography.bodyMd,
      color: c.textMuted,
      marginBottom: spacing.xl,
      lineHeight: 22,
    },
    actionsContainer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: spacing.sm,
    },
    actionsStacked: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    actionButtonWrapper: {
      minWidth: 100,
    },
    actionButtonFlex: {
      flex: 1,
    },
  });
}

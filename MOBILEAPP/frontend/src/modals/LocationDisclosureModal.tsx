import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MapPin, Radio, Clock, ShieldCheck, Settings as SettingsIcon } from 'lucide-react-native';
import { ColorPalette, settingsColorPaletteService } from '../services/settingsColorPaletteService';

/**
 * Prominent disclosure for location collection, required by Google Play's User Data
 * policy before any location runtime permission is requested.
 *
 * Rules this screen has to satisfy, and why it is built the way it is:
 *  - It must appear IMMEDIATELY BEFORE the runtime permission prompt, in the app itself.
 *    A privacy policy or a store listing does not count.
 *  - It must name the data collected, say it is collected in the background even when the
 *    app is closed, and say what it is used for.
 *  - It must require an affirmative action to proceed. So there is no close button, no
 *    tap-outside-to-dismiss, and the Android back button does not dismiss it — the user
 *    has to choose "Allow" or "Not now".
 *
 * Stage 1 is the disclosure. Stage 2 is shown only when the OS is about to ask for the
 * "Allow all the time" background choice on its own screen, so the user knows what to
 * pick when they get there.
 */

interface LocationDisclosureModalProps {
    visible: boolean;
    /** 'disclosure' = the main notice; 'background' = the pre-amble to the OS settings screen. */
    stage?: 'disclosure' | 'background';
    onAccept: () => void;
    onDecline: () => void;
}

const LocationDisclosureModal: React.FC<LocationDisclosureModalProps> = ({
    visible,
    stage = 'disclosure',
    onAccept,
    onDecline,
}) => {
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    useEffect(() => {
        if (!visible) return;
        settingsColorPaletteService
            .getActive()
            .then(setColorPalette)
            .catch(() => null);
    }, [visible]);

    if (!visible) return null;

    const primary = colorPalette?.primary || '#7c3aed';
    const isBackgroundStage = stage === 'background';

    const points = [
        {
            icon: MapPin,
            title: 'What is collected',
            body: 'Your device\'s precise location — latitude and longitude, along with accuracy, '
                + 'speed and heading.',
        },
        {
            icon: Radio,
            title: 'Collected in the background',
            body: 'Your location is collected and sent roughly every 10 seconds while you are on '
                + 'duty. This continues in the background, even when the app is minimised, the '
                + 'screen is off, or the app has been closed.',
        },
        {
            icon: ShieldCheck,
            title: 'What it is used for',
            body: 'Only so your dispatch team can see where you are on the live monitor, assign '
                + 'you to nearby job orders, and confirm site visits. It is sent to the ATSS '
                + 'server and is not sold or shared for advertising.',
        },
        {
            icon: Clock,
            title: 'When it stops',
            body: 'Collection applies to technician accounts only, and stops as soon as you sign '
                + 'out. You can withdraw permission at any time in your device settings.',
        },
    ];

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            statusBarTranslucent
            // The disclosure must not be dismissible without a choice, so the hardware
            // back button is deliberately a no-op here.
            onRequestClose={() => { }}
        >
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <View style={[styles.iconCircle, { backgroundColor: `${primary}1A` }]}>
                        {isBackgroundStage
                            ? <SettingsIcon size={26} color={primary} />
                            : <MapPin size={26} color={primary} />}
                    </View>

                    <Text style={styles.title}>
                        {isBackgroundStage
                            ? 'One more step'
                            : 'ATSS collects your location'}
                    </Text>

                    {isBackgroundStage ? (
                        <>
                            <Text style={styles.lead}>
                                Your phone will now ask how you want to share location. To keep
                                dispatch updated while you are working, choose
                                {' '}<Text style={styles.strong}>“Allow all the time”</Text>.
                            </Text>
                            <Text style={styles.lead}>
                                If you choose “Only while using the app”, your location is shared
                                only while ATSS is open on screen. Everything else in the app keeps
                                working either way.
                            </Text>
                        </>
                    ) : (
                        <>
                            {/* The policy-critical sentence lives here, outside the ScrollView
                                below, so it can never be scrolled out of view on a small
                                screen. Everything under it is elaboration. */}
                            <Text style={styles.lead}>
                                ATSS collects your <Text style={styles.strong}>precise location</Text>
                                {' '}and sends it to your dispatch team while you are on duty —
                                {' '}<Text style={styles.strong}>including in the background, when the
                                app is closed or not in use</Text>. Details below.
                            </Text>

                            <ScrollView
                                style={styles.pointsScroll}
                                contentContainerStyle={styles.points}
                                showsVerticalScrollIndicator
                            >
                                {points.map(({ icon: Icon, title, body }) => (
                                    <View key={title} style={styles.point}>
                                        <View style={styles.pointIcon}>
                                            <Icon size={18} color={primary} />
                                        </View>
                                        <View style={styles.pointText}>
                                            <Text style={styles.pointTitle}>{title}</Text>
                                            <Text style={styles.pointBody}>{body}</Text>
                                        </View>
                                    </View>
                                ))}
                            </ScrollView>
                        </>
                    )}

                    <TouchableOpacity
                        style={[styles.primaryBtn, { backgroundColor: primary }]}
                        onPress={onAccept}
                        activeOpacity={0.85}
                    >
                        <Text style={styles.primaryBtnText}>
                            {isBackgroundStage ? 'Continue' : 'Allow location sharing'}
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={onDecline}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.secondaryBtnText}>
                            {isBackgroundStage ? 'Skip for now' : 'Not now'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 22,
    },
    card: {
        width: '100%',
        maxWidth: 420,
        backgroundColor: '#ffffff',
        borderRadius: 22,
        paddingHorizontal: 22,
        paddingTop: 26,
        paddingBottom: 18,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.22,
        shadowRadius: 18,
        elevation: 12,
    },
    iconCircle: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
    },
    title: {
        fontSize: 20,
        fontWeight: '800',
        color: '#111827',
        textAlign: 'center',
        marginBottom: 8,
    },
    lead: {
        fontSize: 13.5,
        lineHeight: 20,
        color: '#4b5563',
        textAlign: 'center',
        marginBottom: 12,
    },
    strong: { fontWeight: '800', color: '#111827' },
    pointsScroll: { alignSelf: 'stretch', maxHeight: 268, marginBottom: 6 },
    points: { paddingBottom: 4 },
    point: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
    pointIcon: {
        width: 30,
        alignItems: 'center',
        paddingTop: 2,
    },
    pointText: { flex: 1 },
    pointTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 2,
    },
    pointBody: {
        fontSize: 12.5,
        lineHeight: 18,
        color: '#4b5563',
    },
    primaryBtn: {
        alignSelf: 'stretch',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    primaryBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '700',
    },
    secondaryBtn: {
        alignSelf: 'stretch',
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 4,
    },
    secondaryBtnText: {
        color: '#6b7280',
        fontSize: 14,
        fontWeight: '600',
    },
});

export default LocationDisclosureModal;

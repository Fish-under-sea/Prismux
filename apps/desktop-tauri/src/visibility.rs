use serde::{Deserialize, Serialize};

/// Event channel emitted to the workbench frontend whenever visibility or FPS limit changes.
pub const VISIBILITY_EVENT_NAME: &str = "prismux://visibility";

/// Default active wallpaper frame-rate cap when visible and not on battery saver.
pub const DEFAULT_TARGET_FPS: u32 = 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibilitySignal {
    pub occluded: bool,
    pub minimized: bool,
    pub power_saver: bool,
    pub reason: String,
    pub target_fps: u32,
}

/// Deterministic state machine computing the 0 FPS sleep signal whenever the window
/// is minimized, occluded, hidden, or under power-saving constraints.
#[derive(Debug, Clone)]
pub struct VisibilityState {
    occluded: bool,
    minimized: bool,
    power_saver: bool,
    focused: bool,
    configured_fps: u32,
    custom_reason: Option<String>,
}

impl Default for VisibilityState {
    fn default() -> Self {
        Self::new(DEFAULT_TARGET_FPS)
    }
}

impl VisibilityState {
    pub fn new(configured_fps: u32) -> Self {
        Self {
            occluded: false,
            minimized: false,
            power_saver: false,
            focused: true,
            configured_fps: clamp_configured_fps(configured_fps),
            custom_reason: None,
        }
    }

    pub fn set_configured_fps(&mut self, fps: u32) -> VisibilitySignal {
        self.configured_fps = clamp_configured_fps(fps);
        self.signal()
    }

    pub fn set_minimized(&mut self, minimized: bool, reason: Option<&str>) -> VisibilitySignal {
        self.minimized = minimized;
        if minimized {
            self.custom_reason = reason.map(ToString::to_string);
        } else if !self.occluded && !self.power_saver {
            self.custom_reason = None;
        }
        self.signal()
    }

    pub fn set_occluded(&mut self, occluded: bool, reason: Option<&str>) -> VisibilitySignal {
        self.occluded = occluded;
        if occluded {
            self.custom_reason = reason.map(ToString::to_string);
        } else if !self.minimized && !self.power_saver {
            self.custom_reason = None;
        }
        self.signal()
    }

    pub fn set_power_saver(&mut self, power_saver: bool, reason: Option<&str>) -> VisibilitySignal {
        self.power_saver = power_saver;
        if power_saver {
            self.custom_reason = reason.map(ToString::to_string);
        } else if !self.minimized && !self.occluded {
            self.custom_reason = None;
        }
        self.signal()
    }

    pub fn set_focused(&mut self, focused: bool) -> VisibilitySignal {
        self.focused = focused;
        self.signal()
    }

    pub fn is_focused(&self) -> bool {
        self.focused
    }

    /// Computes the current `VisibilitySignal`.
    /// Any of `minimized || occluded || power_saver` forces `target_fps = 0`.
    pub fn signal(&self) -> VisibilitySignal {
        let paused = self.minimized || self.occluded || self.power_saver;
        let reason = if self.minimized {
            self.custom_reason
                .clone()
                .unwrap_or_else(|| "window-minimized".to_string())
        } else if self.occluded {
            self.custom_reason
                .clone()
                .unwrap_or_else(|| "window-occluded".to_string())
        } else if self.power_saver {
            self.custom_reason
                .clone()
                .unwrap_or_else(|| "power-saver".to_string())
        } else if !self.focused {
            "visible-unfocused".to_string()
        } else {
            "visible".to_string()
        };

        VisibilitySignal {
            occluded: self.occluded,
            minimized: self.minimized,
            power_saver: self.power_saver,
            reason,
            target_fps: if paused { 0 } else { self.configured_fps },
        }
    }
}

fn clamp_configured_fps(fps: u32) -> u32 {
    if fps == 0 {
        DEFAULT_TARGET_FPS
    } else {
        fps.clamp(1, 240)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_defaults_to_60_fps_and_respects_custom_cap() {
        let mut state = VisibilityState::default();
        let initial = state.signal();
        assert!(!initial.occluded);
        assert!(!initial.minimized);
        assert!(!initial.power_saver);
        assert_eq!(initial.target_fps, 60);
        assert_eq!(initial.reason, "visible");

        let capped = state.set_configured_fps(30);
        assert_eq!(capped.target_fps, 30);

        let unfocused = state.set_focused(false);
        assert_eq!(unfocused.target_fps, 30);
        assert_eq!(unfocused.reason, "visible-unfocused");
    }

    #[test]
    fn minimized_occluded_or_power_saver_forces_zero_fps() {
        let mut state = VisibilityState::new(60);

        // Minimize -> 0 FPS
        let min_sig = state.set_minimized(true, None);
        assert!(min_sig.minimized);
        assert_eq!(min_sig.target_fps, 0);
        assert_eq!(min_sig.reason, "window-minimized");

        // Also occluded while minimized -> remains 0 FPS
        let occ_and_min = state.set_occluded(true, Some("fullscreen-cover"));
        assert!(occ_and_min.minimized);
        assert!(occ_and_min.occluded);
        assert_eq!(occ_and_min.target_fps, 0);

        // Restore minimize while still occluded -> must STILL be 0 FPS!
        let restored_still_occ = state.set_minimized(false, None);
        assert!(!restored_still_occ.minimized);
        assert!(restored_still_occ.occluded);
        assert_eq!(restored_still_occ.target_fps, 0);

        // Clear occlusion -> restores 60 FPS
        let visible_again = state.set_occluded(false, None);
        assert!(!visible_again.occluded);
        assert_eq!(visible_again.target_fps, 60);
        assert_eq!(visible_again.reason, "visible");

        // Power saver -> 0 FPS, clear -> 60 FPS
        let saver_on = state.set_power_saver(true, Some("battery-critical"));
        assert!(saver_on.power_saver);
        assert_eq!(saver_on.target_fps, 0);
        assert_eq!(saver_on.reason, "battery-critical");

        let saver_off = state.set_power_saver(false, None);
        assert!(!saver_off.power_saver);
        assert_eq!(saver_off.target_fps, 60);
    }
}

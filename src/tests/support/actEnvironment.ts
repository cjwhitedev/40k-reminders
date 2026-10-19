// Tells React the tests drive rendering through act(); without it React warns on every act() call.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

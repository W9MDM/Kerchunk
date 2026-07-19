// Central Font Awesome setup. Using the SVG-core + React component so icons are
// bundled inline (no webfont, no CSP/network issues in Electron).
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';

config.autoAddCss = false; // we import the CSS above ourselves

export { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
export {
  faGear,
  faTowerBroadcast,
  faMicrophone,
  faLocationDot,
  faUser,
  faRotate,
  faLinkSlash,
  faXmark,
  faMagnifyingGlass,
  faThumbtack,
  faTrash,
  faPlus,
  faSatelliteDish,
  faCirclePlus,
  faHeadset,
  faSliders,
  faKeyboard,
  faPaperPlane,
  faListUl,
  faGlobe,
  faSignal,
  faCircleCheck,
  faTriangleExclamation,
  faVolumeHigh,
  faVolumeXmark,
  faChevronDown,
  faChevronRight,
  faFloppyDisk,
  faClockRotateLeft,
  faMicrophoneLines,
  faBolt,
  faBars,
  faRightFromBracket,
  faIdCard,
  faCircleInfo,
  faWandMagicSparkles,
  faGripVertical,
  faUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';

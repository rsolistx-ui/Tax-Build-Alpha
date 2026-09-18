import 'framer-motion';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'motion.div': React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
        animate?: any;
        initial?: any;
        exit?: any;
        transition?: any;
        variants?: any;
        whileHover?: any;
        whileTap?: any;
        whileFocus?: any;
        whileDrag?: any;
        onAnimationStart?: any;
        onAnimationComplete?: any;
        onUpdate?: any;
        onDragStart?: any;
        onDrag?: any;
        onDragEnd?: any;
        drag?: any;
        dragConstraints?: any;
        dragDirectionLock?: boolean;
        dragElastic?: number;
        dragMomentum?: boolean;
        dragPropagation?: boolean;
        onDragTransitionEnd?: any;
        onMeasure?: any;
        layout?: boolean | string;
        layoutId?: string;
        layoutDependency?: any[];
        onLayoutAnimationStart?: any;
        onLayoutAnimationComplete?: any;
        onLayoutMeasure?: any;
      };
      'motion.span': React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
        animate?: any;
        initial?: any;
        exit?: any;
        transition?: any;
        variants?: any;
      };
      'motion.button': React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
        animate?: any;
        initial?: any;
        exit?: any;
        transition?: any;
        variants?: any;
        whileHover?: any;
        whileTap?: any;
      };
      'motion.img': React.DetailedHTMLProps<React.ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement> & {
        animate?: any;
        initial?: any;
        exit?: any;
        transition?: any;
      };
    }
  }
}
// Metro/Expo can import CSS for web builds; TypeScript needs these ambient
// declarations so the imports in src/ typecheck.
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.css';

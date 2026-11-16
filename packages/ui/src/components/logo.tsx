import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M5 5H11V14H5Z M7 14H9V15H7Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 20L36 26V82H13Q8 82 8 77Z" fill="var(--icon-base)" />
      <path d="M44 26L72 20V77Q72 82 67 82H44Z" fill="var(--icon-base)" />
      <rect x="36" y="26" width="8" height="56" fill="var(--icon-strong-base)" />
      <path d="M8 20L36 26H44L72 20" stroke="var(--icon-strong-base)" stroke-width="3" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 264 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path
          d="M0 3H24V9H0Z M0 9H6V33H0Z M0 33H24V39H0Z M30 3H36V39H30Z M36 3H54V9H36Z M36 15H54V21H36Z M60 3H66V39H60Z M66 3H84V9H66Z M66 15H84V21H66Z M90 3H96V39H90Z M96 9H102V15H96Z M102 15H108V21H102Z M120 3H126V39H120Z M126 9H132V15H126Z M132 15H138V21H132Z M150 3H174V9H150Z M150 9H156V33H150Z M150 33H174V39H150Z M180 3H186V27H180Z M186 27H198V39H186Z M210 3H216V39H210Z M216 3H234V9H216Z M216 15H234V21H216Z M240 3H246V39H240Z M246 33H264V39H246Z"
          fill="var(--icon-base)"
        />
        <path
          d="M18 9H24V33H18Z M48 9H54V15H48Z M66 33H84V39H66Z M108 3H114V39H108Z M138 3H144V39H138Z M168 9H174V33H168Z M198 3H204V27H198Z M216 33H234V39H216Z"
          fill="var(--icon-weak-base)"
        />
      </g>
    </svg>
  )
}

import { rec, CB_PALETTE } from "../manifest";

export function BrandHeaderSection() {
  const header = rec("rec776467156");
  return (
    <header
      id={header.id}
      className="h-[75px]"
      style={{ background: CB_PALETTE.bg, fontFamily: "'Sf-pro-display', Arial, sans-serif" }}
    >
      <div className="mx-auto flex h-full max-w-[1160px] items-center px-5">
        <p
          className="text-[20px] font-normal leading-none"
          style={{ color: CB_PALETTE.textStrong, letterSpacing: "3px" }}
        >
          {header.text[0]}
        </p>
      </div>
    </header>
  );
}

// The production icon, as GitHub shows the Prismux app, whatever this build's channel.
import appIconUrl from "../../../../assets/prismux/prismux-256.png";

export function T3AppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}

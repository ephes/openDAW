import {createElement, replaceChildren} from "../create-element"
import {Exec, isDefined, Option, Provider, safeExecute, Terminable, TerminableOwner, Terminator} from "@opendaw/lib-std"
import {JsxValue} from "../types"
import {RouteLocation, RouteMatcher} from "../routes"

export type PageContext<SERVICE = never> = {
    service: SERVICE
    lifecycle: TerminableOwner
    path: string
    error: string
}

export type PageFactory<SERVICE = never> = (context: PageContext<SERVICE>) => JsxValue | Promise<JsxValue>

export type RouterConstruct<SERVICE = never> = {
    runtime: TerminableOwner
    service: SERVICE
    routes: Array<{ path: string, factory: PageFactory<SERVICE> }>
    fallback: PageFactory<SERVICE>
    error?: PageFactory<SERVICE>
    preloader?: Provider<Terminable>
    onshow?: Exec
}

type PageRequest = {
    lifecycle: Terminable
    preloader: Option<Terminable>
    path: string
    state: "loading" | "cancelled"
}

export const Router = <SERVICE = never>({
                                            runtime,
                                            service,
                                            routes,
                                            fallback,
                                            preloader,
                                            error,
                                            onshow
                                        }: RouterConstruct<SERVICE>) => {
    const routing = RouteMatcher.create(routes)
    const resolvePageFactory = (path: string): PageFactory<SERVICE> => routing
        .resolve(path)
        .mapOr(route => route.factory, () => fallback)

    const container: HTMLDivElement = <div style={{display: "contents"}}/>

    let terminated = false
    let loading: Option<PageRequest> = Option.None
    let showing: Option<PageRequest> = Option.None

    const stopPreloader = (request: PageRequest): void => {
        const preloader = request.preloader
        request.preloader = Option.None
        preloader.ifSome(owner => owner.terminate())
    }
    const cancelLoading = (): void => {
        const request = loading.unwrapOrNull()
        loading = Option.None
        if (request !== null) {
            request.state = "cancelled"
            stopPreloader(request)
            request.lifecycle.terminate()
        }
    }
    const owns = (request: PageRequest): boolean =>
        !terminated && request.state === "loading" && loading.unwrapOrNull() === request

    const fetchPage = async (pageFactory: PageFactory<SERVICE>, path: string,
                             errorAttempt = false, reason = ""): Promise<void> => {
        if (terminated) {return}
        cancelLoading()
        const lifecycle = new Terminator()
        const request: PageRequest = {path, lifecycle, preloader: Option.None, state: "loading"}
        loading = Option.wrap(request)
        try {
            const loader = safeExecute(preloader)
            if (owns(request)) {
                request.preloader = Option.wrap(loader)
            } else {
                loader?.terminate()
                return
            }
            const element = await pageFactory({service, lifecycle, path, error: reason})
            if (!owns(request)) {
                lifecycle.terminate()
                return
            }
            stopPreloader(request)
            if (!owns(request)) {return}
            const previous = showing
            showing = Option.None
            previous.ifSome(page => page.lifecycle.terminate())
            if (!owns(request)) {return}
            loading = Option.None
            showing = Option.wrap(request)
            replaceChildren(container, element)
            safeExecute(onshow)
        } catch (reason) {
            if (showing.unwrapOrNull() === request) {
                console.warn(reason)
                return
            }
            if (!owns(request)) {
                lifecycle.terminate()
                return
            }
            cancelLoading()
            console.warn(reason)
            if (isDefined(error) && !errorAttempt) {
                return fetchPage(error, path, true, String(reason))
            }
            if (!isDefined(error)) {alert(`Could not load page (${reason})`)}
        }
    }
    runtime.own({terminate: () => {
        terminated = true
        cancelLoading()
        showing.ifSome(request => request.lifecycle.terminate())
        showing = Option.None
    }})
    const subscription = RouteLocation.get()
        .catchupAndSubscribe((location: RouteLocation) => {
            if (terminated) {return}
            cancelLoading()
            if (showing.unwrapOrNull()?.path === location.path) {
                return
            }
            return fetchPage(resolvePageFactory(location.path), location.path)
        })
    if (terminated) {subscription.terminate()} else {runtime.own(subscription)}
    return container
}